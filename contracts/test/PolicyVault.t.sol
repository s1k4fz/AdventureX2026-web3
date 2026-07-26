// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// NOTE: This test file uses forge-std.  Before running:
//   cd contracts && forge install foundry-rs/forge-std
// Then: forge test -vvv
import "forge-std/Test.sol";

import "../src/PolicyVault.sol";
import "../src/MockUSDC.sol";
import "../src/OutcomeOracle.sol";

/// @title PolicyVaultTest — Comprehensive unit tests for PolicyVault
contract PolicyVaultTest is Test {
    PolicyVault vault;
    MockUSDC usdc;

    address owner = address(0xA1);
    address relayer = address(0xB2);
    address treasury = address(0xC3);
    address user = address(0xD4);

    uint16 constant FEE_BPS = 200; // 2%
    uint64 constant ORACLE_LIVENESS = 300;

    function setUp() public {
        // Deploy MockUSDC
        usdc = new MockUSDC();

        // Deploy PolicyVault
        vm.prank(owner);
        vault = new PolicyVault(
            address(usdc),
            owner,
            relayer,
            treasury,
            FEE_BPS
        );

        // Fund the vault with 100,000 USDC of pool liquidity
        usdc.mint(owner, 100_000e6);
        vm.startPrank(owner);
        usdc.approve(address(vault), type(uint256).max);
        vault.fundPool(100_000e6);
        vm.stopPrank();

        // Give user some USDC
        usdc.mint(user, 10_000e6);
        vm.prank(user);
        usdc.approve(address(vault), type(uint256).max);
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    function _defaultPositions() internal pure returns (PolicyVault.PositionInput[] memory pos) {
        pos = new PolicyVault.PositionInput[](2);
        // Position 0: YES side, entry 60%, weight 50%
        pos[0] = PolicyVault.PositionInput({
            marketRef: keccak256("market-A"),
            sideYes: true,
            entryPriceBps: 6000,
            weightBps: 5000
        });
        // Position 1: NO side, entry 40%, weight 50%
        pos[1] = PolicyVault.PositionInput({
            marketRef: keccak256("market-B"),
            sideYes: false,
            entryPriceBps: 4000,
            weightBps: 5000
        });
    }

    function _openDefaultPolicy(bytes32 policyId, uint256 premium) internal {
        PolicyVault.PositionInput[] memory pos = _defaultPositions();
        vm.prank(user);
        vault.openPolicy(policyId, pos, premium, uint64(block.timestamp + 30 days));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                         HAPPY PATH TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Open a policy, verify state, settle with winning leg, check payout.
    function test_openAndSettle_winningLeg() public {
        bytes32 pid = keccak256("policy-1");
        uint256 premium = 1000e6; // 1000 USDC
        _openDefaultPolicy(pid, premium);

        // Verify fee went to treasury: 1000 * 2% = 20 USDC
        assertEq(usdc.balanceOf(treasury), 20e6, "treasury fee");

        // netPremium = 980 USDC
        // pos0: allocated = 980*5000/10000 = 490 USDC; shares = 490*10000/6000 = 816666666 (816.666666 USDC)
        // pos1: allocated = 490 USDC; shares = 490*10000/4000 = 1225000000 (1225 USDC)
        // maxPayout = 816666666 + 1225000000 = 2041666666

        (address pUser, uint256 pPremium, uint256 pMax, uint64 pEnd, bool pSettled) = vault.policies(pid);
        assertEq(pUser, user);
        assertEq(pPremium, premium);
        assertEq(pMax, 816666666 + 1225000000);
        assertFalse(pSettled);

        // reserved should equal maxPayout
        assertEq(vault.reserved(), pMax);

        // Settle: market-A YES wins, market-B YES wins (so NO loses)
        bool[] memory outcomes = new bool[](2);
        outcomes[0] = true;  // YES won => pos0 wins (sideYes=true)
        outcomes[1] = true;  // YES won => pos1 loses (sideYes=false, side != outcome)

        uint256 userBalBefore = usdc.balanceOf(user);
        vm.prank(relayer);
        vault.settlePolicy(pid, outcomes);

        // Payout = shares of pos0 only = 816666666
        uint256 userBalAfter = usdc.balanceOf(user);
        assertEq(userBalAfter - userBalBefore, 816666666, "payout mismatch");

        // reserved released
        assertEq(vault.reserved(), 0);

        // Policy marked settled
        (,,,,bool settled2) = vault.policies(pid);
        assertTrue(settled2);
    }

    /// @notice Both legs win → payout == maxPayout.
    function test_settle_allLegsWin() public {
        bytes32 pid = keccak256("policy-all-win");
        uint256 premium = 500e6;
        _openDefaultPolicy(pid, premium);

        // pos0 sideYes=true, pos1 sideYes=false
        // outcomes: YES=true for A (pos0 wins), YES=false for B (pos1 wins since sideNo matches)
        bool[] memory outcomes = new bool[](2);
        outcomes[0] = true;   // pos0 wins
        outcomes[1] = false;  // pos1 wins (NO won)

        (,,uint256 maxPay,,) = vault.policies(pid);

        uint256 userBalBefore = usdc.balanceOf(user);
        vm.prank(relayer);
        vault.settlePolicy(pid, outcomes);

        assertEq(usdc.balanceOf(user) - userBalBefore, maxPay, "full payout");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                        FEE ROUTING TEST
    // ═══════════════════════════════════════════════════════════════════════════

    function test_feeRoutedToTreasury() public {
        bytes32 pid = keccak256("fee-test");
        uint256 premium = 2000e6;
        _openDefaultPolicy(pid, premium);
        // fee = 2000 * 200 / 10000 = 40 USDC
        assertEq(usdc.balanceOf(treasury), 40e6);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                       OVER-EXPOSURE REJECTION
    // ═══════════════════════════════════════════════════════════════════════════

    function test_revert_overExposure() public {
        // Vault has 100,000 USDC. Open a policy with huge premium so maxPayout > free liquidity.
        // Give user a ton of USDC
        usdc.mint(user, 1_000_000e6);
        vm.prank(user);
        usdc.approve(address(vault), type(uint256).max);

        // With 200,000 USDC premium, 2% fee => net = 196,000.
        // pos0 shares: 196000/2 * 10000/6000 ≈ 163333e6; pos1 shares: 196000/2 * 10000/4000 = 245000e6
        // maxPayout ≈ 408333e6 which > 100000e6 + 196000e6 (balance) - reserved
        // Actually vault balance after pulling premium = 100000e6 + 200000e6 - 4000e6 (fee) = 296000e6
        // maxPayout = (98000e6 * 10000/6000) + (98000e6 * 10000/4000) = 163333333333 + 245000000000 = 408333333333
        // freeLiquidity = 296000e6 - 0 = 296000000000
        // 408333333333 > 296000000000 → should revert!

        PolicyVault.PositionInput[] memory pos = _defaultPositions();
        vm.prank(user);
        vm.expectRevert("PolicyVault: insufficient liquidity (over-exposure)");
        vault.openPolicy(keccak256("big"), pos, 200_000e6, uint64(block.timestamp + 30 days));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                       ACCESS CONTROL TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    function test_revert_settleByNonRelayer() public {
        bytes32 pid = keccak256("acl-1");
        _openDefaultPolicy(pid, 100e6);

        bool[] memory outcomes = new bool[](2);
        outcomes[0] = true;
        outcomes[1] = false;

        vm.prank(user); // not relayer
        vm.expectRevert("PolicyVault: caller is not relayer");
        vault.settlePolicy(pid, outcomes);
    }

    function test_revert_doubleSettle() public {
        bytes32 pid = keccak256("double");
        _openDefaultPolicy(pid, 100e6);

        bool[] memory outcomes = new bool[](2);
        outcomes[0] = true;
        outcomes[1] = true;

        vm.prank(relayer);
        vault.settlePolicy(pid, outcomes);

        vm.prank(relayer);
        vm.expectRevert("PolicyVault: already settled");
        vault.settlePolicy(pid, outcomes);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                          PAUSE TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    function test_revert_openWhenPaused() public {
        vm.prank(owner);
        vault.pause();

        PolicyVault.PositionInput[] memory pos = _defaultPositions();
        vm.prank(user);
        vm.expectRevert("PolicyVault: paused");
        vault.openPolicy(keccak256("paused-pol"), pos, 100e6, uint64(block.timestamp + 1 days));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                      WEIGHT VALIDATION TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    function test_revert_weightsSumNot10000() public {
        PolicyVault.PositionInput[] memory pos = new PolicyVault.PositionInput[](2);
        pos[0] = PolicyVault.PositionInput({
            marketRef: keccak256("m1"),
            sideYes: true,
            entryPriceBps: 5000,
            weightBps: 3000  // sum = 3000 + 3000 = 6000 ≠ 10000
        });
        pos[1] = PolicyVault.PositionInput({
            marketRef: keccak256("m2"),
            sideYes: false,
            entryPriceBps: 5000,
            weightBps: 3000
        });

        vm.prank(user);
        vm.expectRevert("PolicyVault: weights must sum to 10000");
        vault.openPolicy(keccak256("bad-weights"), pos, 100e6, uint64(block.timestamp + 1 days));
    }

    function test_revert_zeroEntryPrice() public {
        PolicyVault.PositionInput[] memory pos = new PolicyVault.PositionInput[](1);
        pos[0] = PolicyVault.PositionInput({
            marketRef: keccak256("m1"),
            sideYes: true,
            entryPriceBps: 0, // invalid
            weightBps: 10000
        });

        vm.prank(user);
        vm.expectRevert("PolicyVault: invalid entryPriceBps");
        vault.openPolicy(keccak256("zero-entry"), pos, 100e6, uint64(block.timestamp + 1 days));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                    SETTLE FROM ORACLE TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    /// @dev Deploy an OutcomeOracle (zero bond for test simplicity), wire it into the
    ///      vault, then assert + finalize the two default markets with the given
    ///      outcomes so settlePolicyFromOracle can read finalized results.
    function _deployWireAndResolve(bool marketAYes, bool marketBYes) internal returns (OutcomeOracle oracle) {
        oracle = new OutcomeOracle(address(usdc), owner, 0, ORACLE_LIVENESS);
        vm.prank(owner);
        vault.setOutcomeOracle(address(oracle));

        oracle.assertOutcome(keccak256("market-A"), marketAYes);
        oracle.assertOutcome(keccak256("market-B"), marketBYes);
        vm.warp(block.timestamp + ORACLE_LIVENESS);
        oracle.finalize(keccak256("market-A"));
        oracle.finalize(keccak256("market-B"));
    }

    /// @notice Oracle-sourced settlement pays out the winning leg (mirrors
    ///         test_openAndSettle_winningLeg but outcomes come from the oracle).
    function test_settleFromOracle_winningLeg() public {
        bytes32 pid = keccak256("oracle-policy-1");
        uint256 premium = 1000e6;
        _openDefaultPolicy(pid, premium);

        // market-A YES wins (pos0 sideYes=true wins); market-B YES wins (pos1 sideYes=false loses).
        _deployWireAndResolve(true, true);

        uint256 userBalBefore = usdc.balanceOf(user);
        vm.prank(relayer);
        vault.settlePolicyFromOracle(pid);

        // Payout = shares of pos0 only = 816666666 (same math as the raw-settle test).
        assertEq(usdc.balanceOf(user) - userBalBefore, 816666666, "payout mismatch");
        assertEq(vault.reserved(), 0, "reserve not released");
        (,,,, bool settled) = vault.policies(pid);
        assertTrue(settled);
    }

    /// @notice Both legs win via the oracle => payout == maxPayout.
    function test_settleFromOracle_allLegsWin() public {
        bytes32 pid = keccak256("oracle-policy-all-win");
        _openDefaultPolicy(pid, 500e6);
        (,, uint256 maxPay,,) = vault.policies(pid);

        // pos0 sideYes=true needs YES; pos1 sideYes=false needs NO.
        _deployWireAndResolve(true, false);

        uint256 userBalBefore = usdc.balanceOf(user);
        vm.prank(relayer);
        vault.settlePolicyFromOracle(pid);
        assertEq(usdc.balanceOf(user) - userBalBefore, maxPay, "full payout");
    }

    /// @notice Reverts when a leg has not been resolved on the oracle yet.
    function test_revert_settleFromOracle_legNotResolved() public {
        bytes32 pid = keccak256("oracle-unresolved");
        _openDefaultPolicy(pid, 100e6);

        OutcomeOracle oracle = new OutcomeOracle(address(usdc), owner, 0, ORACLE_LIVENESS);
        vm.prank(owner);
        vault.setOutcomeOracle(address(oracle));
        // Only market-A resolved; market-B left unresolved.
        oracle.assertOutcome(keccak256("market-A"), true);
        vm.warp(block.timestamp + ORACLE_LIVENESS);
        oracle.finalize(keccak256("market-A"));

        vm.prank(relayer);
        vm.expectRevert("PolicyVault: leg not resolved");
        vault.settlePolicyFromOracle(pid);
    }

    /// @notice Reverts when no oracle has been wired.
    function test_revert_settleFromOracle_oracleNotSet() public {
        bytes32 pid = keccak256("oracle-missing");
        _openDefaultPolicy(pid, 100e6);
        vm.prank(relayer);
        vm.expectRevert("PolicyVault: oracle not set");
        vault.settlePolicyFromOracle(pid);
    }

    /// @notice Only the relayer may trigger oracle-sourced settlement.
    function test_revert_settleFromOracle_byNonRelayer() public {
        bytes32 pid = keccak256("oracle-acl");
        _openDefaultPolicy(pid, 100e6);
        _deployWireAndResolve(true, false);

        vm.prank(user);
        vm.expectRevert("PolicyVault: caller is not relayer");
        vault.settlePolicyFromOracle(pid);
    }

    /// @notice A disputed (not-yet-resolved) leg blocks settlement.
    function test_revert_settleFromOracle_disputedLeg() public {
        bytes32 pid = keccak256("oracle-disputed");
        _openDefaultPolicy(pid, 100e6);
        OutcomeOracle oracle = new OutcomeOracle(address(usdc), owner, 0, ORACLE_LIVENESS);
        vm.prank(owner);
        vault.setOutcomeOracle(address(oracle));
        oracle.assertOutcome(keccak256("market-A"), true);
        oracle.assertOutcome(keccak256("market-B"), false);
        // Dispute market-B from a non-proposer (bond is 0 here).
        vm.prank(address(0xBEEF));
        oracle.dispute(keccak256("market-B"));
        vm.warp(block.timestamp + ORACLE_LIVENESS);
        oracle.finalize(keccak256("market-A"));
        vm.prank(relayer);
        vm.expectRevert("PolicyVault: leg not resolved");
        vault.settlePolicyFromOracle(pid);
    }

    /// @notice Settling twice via the oracle path reverts.
    function test_revert_doubleSettleFromOracle() public {
        bytes32 pid = keccak256("oracle-double");
        _openDefaultPolicy(pid, 100e6);
        _deployWireAndResolve(true, false);
        vm.prank(relayer);
        vault.settlePolicyFromOracle(pid);
        vm.prank(relayer);
        vm.expectRevert("PolicyVault: already settled");
        vault.settlePolicyFromOracle(pid);
    }

    /// @notice Cross-path double-settle guard: oracle settle then legacy settle.
    function test_revert_crossPath_oracleThenLegacy() public {
        bytes32 pid = keccak256("oracle-then-legacy");
        _openDefaultPolicy(pid, 100e6);
        _deployWireAndResolve(true, false);
        vm.prank(relayer);
        vault.settlePolicyFromOracle(pid);
        bool[] memory outcomes = new bool[](2);
        outcomes[0] = true;
        outcomes[1] = false;
        vm.prank(relayer);
        vm.expectRevert("PolicyVault: already settled");
        vault.settlePolicy(pid, outcomes);
    }

    /// @notice Cross-path double-settle guard: legacy settle then oracle settle.
    function test_revert_crossPath_legacyThenOracle() public {
        bytes32 pid = keccak256("legacy-then-oracle");
        _openDefaultPolicy(pid, 100e6);
        bool[] memory outcomes = new bool[](2);
        outcomes[0] = true;
        outcomes[1] = false;
        vm.prank(relayer);
        vault.settlePolicy(pid, outcomes);
        _deployWireAndResolve(true, false);
        vm.prank(relayer);
        vm.expectRevert("PolicyVault: already settled");
        vault.settlePolicyFromOracle(pid);
    }

    function test_revert_settleFromOracle_policyNotFound() public {
        _deployWireAndResolve(true, false);
        vm.prank(relayer);
        vm.expectRevert("PolicyVault: policy not found");
        vault.settlePolicyFromOracle(keccak256("nonexistent"));
    }

    /// @notice All legs miss => zero payout, but the policy still settles and
    ///         the full reservation is released.
    function test_settleFromOracle_allMiss_zeroPayout() public {
        bytes32 pid = keccak256("oracle-allmiss");
        _openDefaultPolicy(pid, 1000e6);
        // pos0 sideYes=true loses on NO; pos1 sideYes=false loses on YES.
        _deployWireAndResolve(false, true);
        uint256 userBefore = usdc.balanceOf(user);
        vm.prank(relayer);
        vault.settlePolicyFromOracle(pid);
        assertEq(usdc.balanceOf(user) - userBefore, 0, "zero payout");
        assertEq(vault.reserved(), 0, "reserve released");
        (,,,, bool settled) = vault.policies(pid);
        assertTrue(settled);
    }

    /// @notice One on-chain resolution serves multiple policies on the same markets.
    function test_settleFromOracle_sharedMarketRef_twoPolicies() public {
        bytes32 pid1 = keccak256("shared-1");
        bytes32 pid2 = keccak256("shared-2");
        _openDefaultPolicy(pid1, 200e6);
        _openDefaultPolicy(pid2, 300e6);
        _deployWireAndResolve(true, false);
        vm.prank(relayer);
        vault.settlePolicyFromOracle(pid1);
        vm.prank(relayer);
        vault.settlePolicyFromOracle(pid2);
        (,,,, bool s1) = vault.policies(pid1);
        (,,,, bool s2) = vault.policies(pid2);
        assertTrue(s1 && s2, "both settled from one resolution");
        assertEq(vault.reserved(), 0, "all reserves released");
    }

    /// @notice Governance risk documented: replacing the oracle before settling
    ///         drops the prior resolutions, so settlement reverts.
    function test_revert_settleFromOracle_afterOracleReplaced() public {
        bytes32 pid = keccak256("oracle-replaced");
        _openDefaultPolicy(pid, 100e6);
        _deployWireAndResolve(true, false); // oracle1 resolves the markets
        OutcomeOracle oracle2 = new OutcomeOracle(address(usdc), owner, 0, ORACLE_LIVENESS);
        vm.prank(owner);
        vault.setOutcomeOracle(address(oracle2)); // swap to an empty oracle
        vm.prank(relayer);
        vm.expectRevert("PolicyVault: leg not resolved");
        vault.settlePolicyFromOracle(pid);
    }
}
