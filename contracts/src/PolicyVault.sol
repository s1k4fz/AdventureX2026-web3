// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IERC20.sol";
import "./interfaces/IOutcomeOracle.sol";

/// @title PolicyVault — Core insurance-style policy engine for xEngine 差分机
/// @author xEngine
/// @notice Users pay a USDC premium to open a basket of YES/NO positions referencing
///         Polymarket-style markets. The platform vault is the sole counterparty.
///         A trusted relayer settles policies with off-chain resolution results.
/// @dev V1 Trust Model: relayer is platform-controlled. Vault is faucet-funded.
///      Chain: Injective EVM testnet (chainId 1439, legacy tx, gasPrice 160e6 wei).
///
/// ─── Shares / MaxPayout Math ─────────────────────────────────────────────────
/// For each position i in a policy:
///   allocated_i = netPremium * weightBps_i / 10000
///   shares_i    = allocated_i * 10000 / entryPriceBps_i
/// maxPayout     = Σ shares_i
///
/// The vault must hold free liquidity ≥ maxPayout (the "reserve invariant").
/// On settlement, payout = Σ shares_i for legs where the outcome matches the side.
/// reserved is decreased by the FULL maxPayout (not payout), freeing collateral.
/// ─────────────────────────────────────────────────────────────────────────────

contract PolicyVault {
    // ═══════════════════════════════════════════════════════════════════════════
    //                              TYPES
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Input struct passed by the caller when opening a policy.
    struct PositionInput {
        bytes32 marketRef;      // Reference to Polymarket condition
        bool sideYes;           // true = YES position, false = NO position
        uint16 entryPriceBps;   // Entry probability in bps, range (0, 10000]
        uint16 weightBps;       // Fraction of netPremium allocated to this leg (bps)
    }

    /// @notice Stored on-chain per position after computation.
    struct Position {
        bytes32 marketRef;
        bool sideYes;
        uint16 entryPriceBps;
        uint16 weightBps;
        uint256 shares;         // Computed: allocated * 10000 / entryPriceBps
    }

    /// @notice Stored on-chain per policy.
    struct Policy {
        address user;
        uint256 premium;
        uint256 maxPayout;
        uint64 coverageEnd;
        bool settled;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                              STATE
    // ═══════════════════════════════════════════════════════════════════════════

    IERC20 public immutable usdc;
    address public owner;
    address public relayer;
    address public treasury;
    /// @notice Optimistic outcome oracle read by settlePolicyFromOracle. Zero until wired.
    address public outcomeOracle;
    uint16 public feeBps;
    bool public paused;

    /// @notice Total locked max-payout across all open (unsettled) policies.
    uint256 public reserved;

    /// @dev policyId => Policy metadata.
    mapping(bytes32 => Policy) public policies;

    /// @dev policyId => array of computed positions.
    mapping(bytes32 => Position[]) internal _positions;

    // ═══════════════════════════════════════════════════════════════════════════
    //                          REENTRANCY GUARD
    // ═══════════════════════════════════════════════════════════════════════════

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status = _NOT_ENTERED;

    modifier nonReentrant() {
        require(_status != _ENTERED, "PolicyVault: reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                          ACCESS CONTROL
    // ═══════════════════════════════════════════════════════════════════════════

    modifier onlyOwner() {
        require(msg.sender == owner, "PolicyVault: caller is not owner");
        _;
    }

    modifier onlyRelayer() {
        require(msg.sender == relayer, "PolicyVault: caller is not relayer");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "PolicyVault: paused");
        _;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                              EVENTS
    // ═══════════════════════════════════════════════════════════════════════════

    event PolicyOpened(
        bytes32 indexed policyId,
        address indexed user,
        uint256 premium,
        uint256 fee,
        uint256 maxPayout,
        uint64 coverageEnd
    );
    event PolicySettled(bytes32 indexed policyId, uint256 payout);
    event PoolFunded(address indexed from, uint256 amount);
    event PoolWithdrawn(address indexed to, uint256 amount);
    event FeeBpsUpdated(uint16 oldFee, uint16 newFee);
    event RelayerUpdated(address oldRelayer, address newRelayer);
    event TreasuryUpdated(address oldTreasury, address newTreasury);
    event OutcomeOracleUpdated(address oldOracle, address newOracle);
    event OwnerUpdated(address oldOwner, address newOwner);
    event Paused(address by);
    event Unpaused(address by);

    // ═══════════════════════════════════════════════════════════════════════════
    //                            CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════════

    /// @param _usdc Address of the USDC token (6 decimals).
    /// @param _owner Admin/owner address.
    /// @param _relayer Platform relayer hot-key.
    /// @param _treasury Fee recipient address.
    /// @param _feeBps Fee in basis points (max 1000 = 10%).
    constructor(
        address _usdc,
        address _owner,
        address _relayer,
        address _treasury,
        uint16 _feeBps
    ) {
        require(_usdc != address(0), "PolicyVault: zero usdc");
        require(_owner != address(0), "PolicyVault: zero owner");
        require(_relayer != address(0), "PolicyVault: zero relayer");
        require(_treasury != address(0), "PolicyVault: zero treasury");
        require(_feeBps <= 1000, "PolicyVault: feeBps > 10%");

        usdc = IERC20(_usdc);
        owner = _owner;
        relayer = _relayer;
        treasury = _treasury;
        feeBps = _feeBps;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                         LIQUIDITY MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Owner deposits USDC into the vault to fund payouts.
    /// @param amount Amount of USDC (6 decimals) to deposit.
    function fundPool(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "PolicyVault: zero amount");
        _safeTransferFrom(usdc, msg.sender, address(this), amount);
        emit PoolFunded(msg.sender, amount);
    }

    /// @notice Owner withdraws free (unreserved) USDC from the vault.
    /// @param amount Amount to withdraw.
    function withdrawPool(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "PolicyVault: zero amount");
        require(amount <= freeLiquidity(), "PolicyVault: insufficient free liquidity");
        _safeTransfer(usdc, msg.sender, amount);
        emit PoolWithdrawn(msg.sender, amount);
    }

    /// @notice Returns available (unreserved) USDC in the vault.
    /// @dev freeLiquidity = balance - reserved.
    function freeLiquidity() public view returns (uint256) {
        uint256 balance = usdc.balanceOf(address(this));
        // balance should always >= reserved; guard against underflow in edge case.
        if (balance < reserved) return 0;
        return balance - reserved;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                           CORE: OPEN POLICY
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Open a new insurance-style policy with a basket of YES/NO positions.
    /// @param policyId Unique identifier chosen off-chain (must not already exist).
    /// @param positions Array of position inputs with market refs, sides, prices, weights.
    /// @param premium Total USDC premium paid by the user.
    /// @param coverageEnd Unix timestamp when coverage expires (informational for V1).
    function openPolicy(
        bytes32 policyId,
        PositionInput[] calldata positions,
        uint256 premium,
        uint64 coverageEnd
    ) external whenNotPaused nonReentrant {
        require(policies[policyId].user == address(0), "PolicyVault: policyId exists");
        require(premium > 0, "PolicyVault: zero premium");
        require(positions.length > 0, "PolicyVault: no positions");

        // ── Pull premium from user ───────────────────────────────────────────
        _safeTransferFrom(usdc, msg.sender, address(this), premium);

        // ── Fee to treasury ──────────────────────────────────────────────────
        uint256 fee = (premium * uint256(feeBps)) / 10000;
        if (fee > 0) {
            _safeTransfer(usdc, treasury, fee);
        }
        uint256 netPremium = premium - fee;

        // ── Validate weights sum to 10000 & compute positions ────────────────
        uint256 totalWeightBps;
        uint256 maxPayout;
        uint256 len = positions.length;

        for (uint256 i; i < len; ) {
            PositionInput calldata p = positions[i];
            require(p.entryPriceBps > 0 && p.entryPriceBps <= 10000, "PolicyVault: invalid entryPriceBps");
            require(p.weightBps > 0, "PolicyVault: zero weightBps");
            totalWeightBps += uint256(p.weightBps);

            // allocated_i = netPremium * weightBps_i / 10000
            uint256 allocated = (netPremium * uint256(p.weightBps)) / 10000;
            // shares_i = allocated_i * 10000 / entryPriceBps_i
            uint256 shares = (allocated * 10000) / uint256(p.entryPriceBps);

            _positions[policyId].push(Position({
                marketRef: p.marketRef,
                sideYes: p.sideYes,
                entryPriceBps: p.entryPriceBps,
                weightBps: p.weightBps,
                shares: shares
            }));

            maxPayout += shares;
            unchecked { ++i; }
        }

        require(totalWeightBps == 10000, "PolicyVault: weights must sum to 10000");

        // ── Reserve invariant: vault must have enough free liquidity ─────────
        // freeLiquidity AFTER premium arrived and fee left:
        //   balance = (prev_balance + premium - fee) => already happened via transfers above.
        //   current freeLiquidity() = usdc.balanceOf(this) - reserved
        require(freeLiquidity() >= maxPayout, "PolicyVault: insufficient liquidity (over-exposure)");
        reserved += maxPayout;

        // ── Store policy ─────────────────────────────────────────────────────
        policies[policyId] = Policy({
            user: msg.sender,
            premium: premium,
            maxPayout: maxPayout,
            coverageEnd: coverageEnd,
            settled: false
        });

        emit PolicyOpened(policyId, msg.sender, premium, fee, maxPayout, coverageEnd);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                         CORE: SETTLE POLICY
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Relayer settles a policy by providing outcomes for each market leg.
    /// @param policyId The policy to settle.
    /// @param outcomesYes Array of booleans — true if the YES outcome won for each leg.
    function settlePolicy(bytes32 policyId, bool[] calldata outcomesYes) external onlyRelayer nonReentrant {
        Policy storage pol = policies[policyId];
        require(pol.user != address(0), "PolicyVault: policy not found");
        require(!pol.settled, "PolicyVault: already settled");

        Position[] storage pos = _positions[policyId];
        require(outcomesYes.length == pos.length, "PolicyVault: outcomes length mismatch");

        // ── Compute payout ───────────────────────────────────────────────────
        uint256 payout;
        uint256 len = pos.length;
        for (uint256 i; i < len; ) {
            // Position wins if user's side matches the actual outcome.
            if (pos[i].sideYes == outcomesYes[i]) {
                payout += pos[i].shares;
            }
            unchecked { ++i; }
        }

        // ── Update state ─────────────────────────────────────────────────────
        pol.settled = true;
        reserved -= pol.maxPayout; // Release full reservation regardless of actual payout.

        // ── Transfer payout to user ──────────────────────────────────────────
        if (payout > 0) {
            _safeTransfer(usdc, pol.user, payout);
        }

        emit PolicySettled(policyId, payout);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                    CORE: SETTLE POLICY FROM ORACLE
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Settle a policy using outcomes finalized on the OutcomeOracle.
    /// @dev Unlike settlePolicy (which trusts relayer-supplied outcomes), this reads
    ///      each leg's outcome from the on-chain oracle and reverts if any leg is not
    ///      yet Resolved. This is the canonical production settlement path: the
    ///      relayer only triggers settlement, it cannot fabricate the outcomes.
    /// @param policyId The policy to settle.
    function settlePolicyFromOracle(bytes32 policyId) external onlyRelayer nonReentrant {
        require(outcomeOracle != address(0), "PolicyVault: oracle not set");
        Policy storage pol = policies[policyId];
        require(pol.user != address(0), "PolicyVault: policy not found");
        require(!pol.settled, "PolicyVault: already settled");

        Position[] storage pos = _positions[policyId];
        uint256 len = pos.length;

        // ── Read outcomes from the oracle & compute payout ───────────────────
        uint256 payout;
        for (uint256 i; i < len; ) {
            (bool resolved, bool outcomeYes) =
                IOutcomeOracle(outcomeOracle).getResolvedOutcome(pos[i].marketRef);
            require(resolved, "PolicyVault: leg not resolved");
            // Position wins if user's side matches the finalized outcome.
            if (pos[i].sideYes == outcomeYes) {
                payout += pos[i].shares;
            }
            unchecked { ++i; }
        }

        // ── Update state ─────────────────────────────────────────────────────
        pol.settled = true;
        reserved -= pol.maxPayout; // Release full reservation regardless of actual payout.

        // ── Transfer payout to user ──────────────────────────────────────────
        if (payout > 0) {
            _safeTransfer(usdc, pol.user, payout);
        }

        emit PolicySettled(policyId, payout);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                         VIEW HELPERS
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Get all positions for a policy.
    function getPositions(bytes32 policyId) external view returns (Position[] memory) {
        return _positions[policyId];
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                           GOVERNANCE
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Update the platform fee (max 1000 bps = 10%).
    function setFeeBps(uint16 _feeBps) external onlyOwner {
        require(_feeBps <= 1000, "PolicyVault: feeBps > 10%");
        emit FeeBpsUpdated(feeBps, _feeBps);
        feeBps = _feeBps;
    }

    /// @notice Transfer relayer role.
    function setRelayer(address _relayer) external onlyOwner {
        require(_relayer != address(0), "PolicyVault: zero relayer");
        emit RelayerUpdated(relayer, _relayer);
        relayer = _relayer;
    }

    /// @notice Update the fee treasury address.
    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "PolicyVault: zero treasury");
        emit TreasuryUpdated(treasury, _treasury);
        treasury = _treasury;
    }

    /// @notice Set the optimistic outcome oracle used by settlePolicyFromOracle.
    function setOutcomeOracle(address _oracle) external onlyOwner {
        require(_oracle != address(0), "PolicyVault: zero oracle");
        emit OutcomeOracleUpdated(outcomeOracle, _oracle);
        outcomeOracle = _oracle;
    }

    /// @notice Transfer contract ownership.
    function setOwner(address _owner) external onlyOwner {
        require(_owner != address(0), "PolicyVault: zero owner");
        emit OwnerUpdated(owner, _owner);
        owner = _owner;
    }

    /// @notice Pause policy opening (emergency).
    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    /// @notice Unpause policy opening.
    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                     INTERNAL: SAFE ERC-20 HELPERS
    // ═══════════════════════════════════════════════════════════════════════════

    /// @dev SafeERC20-style transfer: handles tokens that return bool or nothing.
    function _safeTransfer(IERC20 token, address to, uint256 amount) internal {
        (bool success, bytes memory data) = address(token).call(
            abi.encodeWithSelector(token.transfer.selector, to, amount)
        );
        require(
            success && (data.length == 0 || abi.decode(data, (bool))),
            "PolicyVault: safeTransfer failed"
        );
    }

    /// @dev SafeERC20-style transferFrom.
    function _safeTransferFrom(IERC20 token, address from, address to, uint256 amount) internal {
        (bool success, bytes memory data) = address(token).call(
            abi.encodeWithSelector(token.transferFrom.selector, from, to, amount)
        );
        require(
            success && (data.length == 0 || abi.decode(data, (bool))),
            "PolicyVault: safeTransferFrom failed"
        );
    }
}
