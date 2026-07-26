// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IERC20.sol";
import "./interfaces/IOutcomeOracle.sol";

/// @title OutcomeOracle — Optimistic oracle for binary market outcomes (xEngine 差分机, M3)
/// @author xEngine
/// @notice A proposer bonds USDC to ASSERT a binary outcome (YES/NO won) for a
///         marketRef. After a challenge window (liveness) elapses with no dispute,
///         the assertion FINALIZES on-chain; PolicyVault reads it at settlement.
///         Anyone may DISPUTE within the window by posting an equal bond; disputes
///         are arbitrated by the owner. This upgrades settlement from "blindly
///         trust the relayer's outcome argument" to an on-chain, bonded, publicly
///         challengeable verification — the same optimistic mechanism UMA and
///         Polymarket use for resolution.
/// @dev V1 Trust Model: the platform relayer is the usual proposer; owner is the
///      dispute arbiter. Data still ORIGINATES off-chain (backend reads Polymarket
///      Gamma) but must survive the on-chain challenge window before it can settle.
///      Bonds are held in USDC (6 decimals). Chain: Injective EVM testnet
///      (chainId 1439, legacy tx, gasPrice 160e6 wei).
///
/// ─── Lifecycle ───────────────────────────────────────────────────────────────
///   None ──assertOutcome──▶ Asserted ──finalize (after liveness)──▶ Resolved
///                              │
///                              └──dispute (within liveness)──▶ Disputed
///                                                                 │
///                                                 resolveDispute (owner) ─▶ Resolved
/// ─────────────────────────────────────────────────────────────────────────────
contract OutcomeOracle is IOutcomeOracle {
    // ═══════════════════════════════════════════════════════════════════════════
    //                              TYPES
    // ═══════════════════════════════════════════════════════════════════════════

    enum Status {
        None, // 0 — no assertion for this marketRef yet
        Asserted, // 1 — proposed, in challenge window
        Disputed, // 2 — challenged, awaiting owner arbitration
        Resolved // 3 — finalized; outcome is immutable
    }

    /// @notice Stored on-chain per marketRef.
    struct Assertion {
        address proposer; // who asserted (posts bond)
        bool assertedYes; // proposed outcome: true = YES won, false = NO won
        uint64 assertTime; // block.timestamp at assertion
        uint64 liveness; // challenge window (seconds) captured at assertion
        uint256 bond; // USDC bond captured at assertion (matched by any disputer)
        address disputer; // who disputed (zero if none)
        Status status;
        bool finalYes; // final outcome once Resolved
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                              STATE
    // ═══════════════════════════════════════════════════════════════════════════

    IERC20 public immutable bondToken; // USDC (6 decimals)
    address public owner; // dispute arbiter + governance
    uint256 public bondAmount; // required bond per assertion (base units)
    uint64 public defaultLiveness; // default challenge window (seconds)

    /// @dev marketRef => assertion state.
    mapping(bytes32 => Assertion) public assertions;

    // ═══════════════════════════════════════════════════════════════════════════
    //                          REENTRANCY GUARD
    // ═══════════════════════════════════════════════════════════════════════════

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status = _NOT_ENTERED;

    modifier nonReentrant() {
        require(_status != _ENTERED, "OutcomeOracle: reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                          ACCESS CONTROL
    // ═══════════════════════════════════════════════════════════════════════════

    modifier onlyOwner() {
        require(msg.sender == owner, "OutcomeOracle: caller is not owner");
        _;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                              EVENTS
    // ═══════════════════════════════════════════════════════════════════════════

    event OutcomeAsserted(
        bytes32 indexed marketRef,
        address indexed proposer,
        bool assertedYes,
        uint256 bond,
        uint64 liveness
    );
    event OutcomeDisputed(bytes32 indexed marketRef, address indexed disputer);
    event OutcomeResolved(bytes32 indexed marketRef, bool finalYes, bool disputed);
    event BondAmountUpdated(uint256 oldBond, uint256 newBond);
    event LivenessUpdated(uint64 oldLiveness, uint64 newLiveness);
    event OwnerUpdated(address oldOwner, address newOwner);

    // ═══════════════════════════════════════════════════════════════════════════
    //                            CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════════

    /// @param _bondToken USDC token used for bonds (6 decimals).
    /// @param _owner Admin/owner + dispute arbiter.
    /// @param _bondAmount Required bond per assertion (base units; may be 0 for demos).
    /// @param _defaultLiveness Challenge window in seconds (must be > 0).
    constructor(address _bondToken, address _owner, uint256 _bondAmount, uint64 _defaultLiveness) {
        require(_bondToken != address(0), "OutcomeOracle: zero bondToken");
        require(_owner != address(0), "OutcomeOracle: zero owner");
        require(_defaultLiveness > 0, "OutcomeOracle: zero liveness");

        bondToken = IERC20(_bondToken);
        owner = _owner;
        bondAmount = _bondAmount;
        defaultLiveness = _defaultLiveness;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                         CORE: ASSERT OUTCOME
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Assert a binary outcome for a market, posting the required bond.
    /// @param marketRef The market reference (bytes32 conditionId as stored on-chain).
    /// @param outcomeYes True to assert YES won, false to assert NO won.
    function assertOutcome(bytes32 marketRef, bool outcomeYes) external nonReentrant {
        Assertion storage a = assertions[marketRef];
        require(a.status == Status.None, "OutcomeOracle: already asserted");

        uint256 bond = bondAmount;
        if (bond > 0) {
            _safeTransferFrom(bondToken, msg.sender, address(this), bond);
        }

        a.proposer = msg.sender;
        a.assertedYes = outcomeYes;
        a.assertTime = uint64(block.timestamp);
        a.liveness = defaultLiveness;
        a.bond = bond;
        a.status = Status.Asserted;

        emit OutcomeAsserted(marketRef, msg.sender, outcomeYes, bond, defaultLiveness);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                         CORE: DISPUTE
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Dispute an active assertion within its challenge window by posting
    ///         a matching bond. Escalates to owner arbitration.
    /// @param marketRef The market whose assertion is being challenged.
    function dispute(bytes32 marketRef) external nonReentrant {
        Assertion storage a = assertions[marketRef];
        require(a.status == Status.Asserted, "OutcomeOracle: not disputable");
        require(block.timestamp < a.assertTime + a.liveness, "OutcomeOracle: window closed");
        require(msg.sender != a.proposer, "OutcomeOracle: proposer cannot dispute");

        if (a.bond > 0) {
            _safeTransferFrom(bondToken, msg.sender, address(this), a.bond);
        }

        a.disputer = msg.sender;
        a.status = Status.Disputed;

        emit OutcomeDisputed(marketRef, msg.sender);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                         CORE: FINALIZE (undisputed)
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Finalize an undisputed assertion after its challenge window elapses.
    ///         Returns the proposer's bond. Callable by anyone (permissionless).
    /// @param marketRef The market to finalize.
    function finalize(bytes32 marketRef) external nonReentrant {
        Assertion storage a = assertions[marketRef];
        require(a.status == Status.Asserted, "OutcomeOracle: not finalizable");
        require(block.timestamp >= a.assertTime + a.liveness, "OutcomeOracle: window open");

        a.status = Status.Resolved;
        a.finalYes = a.assertedYes;

        if (a.bond > 0) {
            _safeTransfer(bondToken, a.proposer, a.bond);
        }

        emit OutcomeResolved(marketRef, a.finalYes, false);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                         CORE: RESOLVE DISPUTE (owner)
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Arbitrate a disputed assertion. The winning side (proposer if the
    ///         asserted value matches the final ruling, else the disputer) receives
    ///         both bonds.
    /// @param marketRef The disputed market.
    /// @param finalYes The arbitrated outcome: true = YES won, false = NO won.
    function resolveDispute(bytes32 marketRef, bool finalYes) external onlyOwner nonReentrant {
        Assertion storage a = assertions[marketRef];
        require(a.status == Status.Disputed, "OutcomeOracle: not disputed");

        a.status = Status.Resolved;
        a.finalYes = finalYes;

        // Winner takes both bonds. proposer was right iff assertedYes == finalYes.
        uint256 pot = a.bond * 2;
        if (pot > 0) {
            address winner = (a.assertedYes == finalYes) ? a.proposer : a.disputer;
            _safeTransfer(bondToken, winner, pot);
        }

        emit OutcomeResolved(marketRef, finalYes, true);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                         VIEW HELPERS
    // ═══════════════════════════════════════════════════════════════════════════

    /// @inheritdoc IOutcomeOracle
    function getResolvedOutcome(bytes32 marketRef)
        external
        view
        override
        returns (bool resolved, bool outcomeYes)
    {
        Assertion storage a = assertions[marketRef];
        if (a.status == Status.Resolved) {
            return (true, a.finalYes);
        }
        return (false, false);
    }

    /// @notice Whether an active assertion's challenge window has elapsed.
    /// @dev Returns false unless the assertion is currently in the Asserted state.
    function isFinalizable(bytes32 marketRef) external view returns (bool) {
        Assertion storage a = assertions[marketRef];
        return a.status == Status.Asserted && block.timestamp >= a.assertTime + a.liveness;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                           GOVERNANCE
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Update the required bond for FUTURE assertions.
    function setBondAmount(uint256 _bondAmount) external onlyOwner {
        emit BondAmountUpdated(bondAmount, _bondAmount);
        bondAmount = _bondAmount;
    }

    /// @notice Update the default challenge window for FUTURE assertions.
    function setDefaultLiveness(uint64 _liveness) external onlyOwner {
        require(_liveness > 0, "OutcomeOracle: zero liveness");
        emit LivenessUpdated(defaultLiveness, _liveness);
        defaultLiveness = _liveness;
    }

    /// @notice Transfer ownership (dispute arbiter role).
    function setOwner(address _owner) external onlyOwner {
        require(_owner != address(0), "OutcomeOracle: zero owner");
        emit OwnerUpdated(owner, _owner);
        owner = _owner;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                     INTERNAL: SAFE ERC-20 HELPERS
    // ═══════════════════════════════════════════════════════════════════════════

    /// @dev SafeERC20-style transfer: handles tokens that return bool or nothing.
    function _safeTransfer(IERC20 token, address to, uint256 amount) internal {
        (bool success, bytes memory data) =
            address(token).call(abi.encodeWithSelector(token.transfer.selector, to, amount));
        require(
            success && (data.length == 0 || abi.decode(data, (bool))),
            "OutcomeOracle: safeTransfer failed"
        );
    }

    /// @dev SafeERC20-style transferFrom.
    function _safeTransferFrom(IERC20 token, address from, address to, uint256 amount) internal {
        (bool success, bytes memory data) =
            address(token).call(abi.encodeWithSelector(token.transferFrom.selector, from, to, amount));
        require(
            success && (data.length == 0 || abi.decode(data, (bool))),
            "OutcomeOracle: safeTransferFrom failed"
        );
    }
}
