// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// NOTE: uses forge-std. Run from contracts/: forge test -vvv
import "forge-std/Test.sol";

import "../src/OutcomeOracle.sol";
import "../src/MockUSDC.sol";

/// @title OutcomeOracleTest — unit tests for the optimistic outcome oracle
contract OutcomeOracleTest is Test {
    OutcomeOracle oracle;
    MockUSDC usdc;

    address owner = address(0xA1);
    address proposer = address(0xB2);
    address disputer = address(0xC3);

    uint256 constant BOND = 10e6; // 10 USDC
    uint64 constant LIVENESS = 300; // 5 minutes

    bytes32 constant MARKET = keccak256("market-A");

    function setUp() public {
        usdc = new MockUSDC();
        vm.prank(owner);
        oracle = new OutcomeOracle(address(usdc), owner, BOND, LIVENESS);

        // Fund proposer + disputer and pre-approve the oracle.
        usdc.mint(proposer, 1_000e6);
        usdc.mint(disputer, 1_000e6);
        vm.prank(proposer);
        usdc.approve(address(oracle), type(uint256).max);
        vm.prank(disputer);
        usdc.approve(address(oracle), type(uint256).max);
    }

    // ─── Helpers ────────────────────────────────────────────────────────────
    function _assert(bool outcomeYes) internal {
        vm.prank(proposer);
        oracle.assertOutcome(MARKET, outcomeYes);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         ASSERT
    // ═══════════════════════════════════════════════════════════════════════

    function test_assert_pullsBondAndSetsState() public {
        uint256 balBefore = usdc.balanceOf(proposer);
        _assert(true);

        assertEq(usdc.balanceOf(proposer), balBefore - BOND, "bond not pulled");
        assertEq(usdc.balanceOf(address(oracle)), BOND, "oracle did not hold bond");

        (
            address p,
            bool assertedYes,
            ,
            uint64 liveness,
            uint256 bond,
            address d,
            OutcomeOracle.Status status,

        ) = oracle.assertions(MARKET);
        assertEq(p, proposer);
        assertTrue(assertedYes);
        assertEq(liveness, LIVENESS);
        assertEq(bond, BOND);
        assertEq(d, address(0));
        assertEq(uint256(status), uint256(OutcomeOracle.Status.Asserted));

        // Not resolved yet.
        (bool resolved,) = oracle.getResolvedOutcome(MARKET);
        assertFalse(resolved);
    }

    function test_revert_doubleAssert() public {
        _assert(true);
        vm.prank(proposer);
        vm.expectRevert("OutcomeOracle: already asserted");
        oracle.assertOutcome(MARKET, false);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         FINALIZE (undisputed)
    // ═══════════════════════════════════════════════════════════════════════

    function test_finalize_afterLiveness_resolvesAndReturnsBond() public {
        _assert(true);
        uint256 balBefore = usdc.balanceOf(proposer);

        vm.warp(block.timestamp + LIVENESS);
        oracle.finalize(MARKET); // permissionless

        (bool resolved, bool outcomeYes) = oracle.getResolvedOutcome(MARKET);
        assertTrue(resolved, "not resolved");
        assertTrue(outcomeYes, "wrong outcome");
        assertEq(usdc.balanceOf(proposer), balBefore + BOND, "bond not returned");
        assertEq(usdc.balanceOf(address(oracle)), 0, "oracle still holds funds");
    }

    function test_revert_finalizeBeforeLiveness() public {
        _assert(true);
        vm.expectRevert("OutcomeOracle: window open");
        oracle.finalize(MARKET);
    }

    function test_revert_finalizeWhenDisputed() public {
        _assert(true);
        vm.prank(disputer);
        oracle.dispute(MARKET);
        vm.warp(block.timestamp + LIVENESS);
        vm.expectRevert("OutcomeOracle: not finalizable");
        oracle.finalize(MARKET);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         DISPUTE + RESOLVE
    // ═══════════════════════════════════════════════════════════════════════

    function test_dispute_pullsMatchingBond() public {
        _assert(true);
        uint256 balBefore = usdc.balanceOf(disputer);
        vm.prank(disputer);
        oracle.dispute(MARKET);

        assertEq(usdc.balanceOf(disputer), balBefore - BOND, "disputer bond not pulled");
        assertEq(usdc.balanceOf(address(oracle)), BOND * 2, "oracle should hold both bonds");

        (,,,,, address d, OutcomeOracle.Status status,) = oracle.assertions(MARKET);
        assertEq(d, disputer);
        assertEq(uint256(status), uint256(OutcomeOracle.Status.Disputed));
    }

    function test_revert_disputeByProposer() public {
        _assert(true);
        vm.prank(proposer);
        vm.expectRevert("OutcomeOracle: proposer cannot dispute");
        oracle.dispute(MARKET);
    }

    function test_revert_disputeAfterWindow() public {
        _assert(true);
        vm.warp(block.timestamp + LIVENESS);
        vm.prank(disputer);
        vm.expectRevert("OutcomeOracle: window closed");
        oracle.dispute(MARKET);
    }

    function test_resolveDispute_proposerRight_takesBothBonds() public {
        _assert(true); // proposer says YES
        vm.prank(disputer);
        oracle.dispute(MARKET);

        uint256 propBefore = usdc.balanceOf(proposer);
        // Owner rules YES (proposer was right).
        vm.prank(owner);
        oracle.resolveDispute(MARKET, true);

        (bool resolved, bool outcomeYes) = oracle.getResolvedOutcome(MARKET);
        assertTrue(resolved);
        assertTrue(outcomeYes);
        assertEq(usdc.balanceOf(proposer), propBefore + BOND * 2, "proposer should win pot");
        assertEq(usdc.balanceOf(address(oracle)), 0);
    }

    function test_resolveDispute_disputerRight_takesBothBonds() public {
        _assert(true); // proposer says YES
        vm.prank(disputer);
        oracle.dispute(MARKET);

        uint256 dispBefore = usdc.balanceOf(disputer);
        // Owner rules NO (disputer was right).
        vm.prank(owner);
        oracle.resolveDispute(MARKET, false);

        (bool resolved, bool outcomeYes) = oracle.getResolvedOutcome(MARKET);
        assertTrue(resolved);
        assertFalse(outcomeYes);
        assertEq(usdc.balanceOf(disputer), dispBefore + BOND * 2, "disputer should win pot");
    }

    function test_revert_resolveByNonOwner() public {
        _assert(true);
        vm.prank(disputer);
        oracle.dispute(MARKET);
        vm.prank(disputer);
        vm.expectRevert("OutcomeOracle: caller is not owner");
        oracle.resolveDispute(MARKET, false);
    }

    function test_revert_resolveWhenNotDisputed() public {
        _assert(true);
        vm.prank(owner);
        vm.expectRevert("OutcomeOracle: not disputed");
        oracle.resolveDispute(MARKET, true);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         VIEW + GOVERNANCE
    // ═══════════════════════════════════════════════════════════════════════

    function test_isFinalizable() public {
        _assert(true);
        assertFalse(oracle.isFinalizable(MARKET));
        vm.warp(block.timestamp + LIVENESS);
        assertTrue(oracle.isFinalizable(MARKET));
    }

    function test_governance_setters() public {
        vm.startPrank(owner);
        oracle.setBondAmount(5e6);
        oracle.setDefaultLiveness(60);
        oracle.setOwner(disputer);
        vm.stopPrank();
        assertEq(oracle.bondAmount(), 5e6);
        assertEq(oracle.defaultLiveness(), 60);
        assertEq(oracle.owner(), disputer);
    }

    function test_revert_setBondByNonOwner() public {
        vm.prank(proposer);
        vm.expectRevert("OutcomeOracle: caller is not owner");
        oracle.setBondAmount(1);
    }

    /// @notice With bondAmount==0, assert/finalize work with no token movement.
    function test_zeroBond_flow() public {
        vm.prank(owner);
        oracle.setBondAmount(0);

        vm.prank(proposer);
        oracle.assertOutcome(MARKET, false);
        assertEq(usdc.balanceOf(address(oracle)), 0, "no bond should be held");

        vm.warp(block.timestamp + LIVENESS);
        oracle.finalize(MARKET);
        (bool resolved, bool outcomeYes) = oracle.getResolvedOutcome(MARKET);
        assertTrue(resolved);
        assertFalse(outcomeYes);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                    ADDITIONAL EDGE CASES
    // ═══════════════════════════════════════════════════════════════════════════

    function test_revert_assertAfterResolved() public {
        _assert(true);
        vm.warp(block.timestamp + LIVENESS);
        oracle.finalize(MARKET);
        vm.prank(proposer);
        vm.expectRevert("OutcomeOracle: already asserted");
        oracle.assertOutcome(MARKET, false);
    }

    function test_revert_doubleFinalize() public {
        _assert(true);
        vm.warp(block.timestamp + LIVENESS);
        oracle.finalize(MARKET);
        vm.expectRevert("OutcomeOracle: not finalizable");
        oracle.finalize(MARKET);
    }

    function test_revert_doubleDispute() public {
        _assert(true);
        vm.prank(disputer);
        oracle.dispute(MARKET);
        vm.prank(disputer);
        vm.expectRevert("OutcomeOracle: not disputable");
        oracle.dispute(MARKET);
    }

    function test_revert_resolveDisputeTwice() public {
        _assert(true);
        vm.prank(disputer);
        oracle.dispute(MARKET);
        vm.prank(owner);
        oracle.resolveDispute(MARKET, true);
        vm.prank(owner);
        vm.expectRevert("OutcomeOracle: not disputed");
        oracle.resolveDispute(MARKET, false);
    }

    /// @notice getResolvedOutcome is false in None / Asserted / Disputed states.
    function test_getResolvedOutcome_falseUntilResolved() public {
        (bool r0,) = oracle.getResolvedOutcome(MARKET);
        assertFalse(r0, "None should be unresolved");
        _assert(true);
        (bool r1,) = oracle.getResolvedOutcome(MARKET);
        assertFalse(r1, "Asserted should be unresolved");
        vm.prank(disputer);
        oracle.dispute(MARKET);
        (bool r2,) = oracle.getResolvedOutcome(MARKET);
        assertFalse(r2, "Disputed should be unresolved");
    }

    /// @notice At exactly assertTime+liveness: dispute is closed, finalize is open.
    function test_boundary_disputeClosed_finalizeOpen() public {
        _assert(true);
        vm.warp(block.timestamp + LIVENESS);
        vm.prank(disputer);
        vm.expectRevert("OutcomeOracle: window closed");
        oracle.dispute(MARKET);
        oracle.finalize(MARKET); // >= boundary => succeeds
        (bool resolved,) = oracle.getResolvedOutcome(MARKET);
        assertTrue(resolved);
    }

    function test_revert_assertWithoutAllowance() public {
        address poor = address(0xBEEF);
        usdc.mint(poor, 1_000e6); // funded but NOT approved to the oracle
        vm.prank(poor);
        vm.expectRevert(); // safeTransferFrom fails (allowance exceeded)
        oracle.assertOutcome(keccak256("noalw"), true);
    }

    function test_constructor_guards() public {
        vm.expectRevert("OutcomeOracle: zero bondToken");
        new OutcomeOracle(address(0), owner, BOND, LIVENESS);
        vm.expectRevert("OutcomeOracle: zero owner");
        new OutcomeOracle(address(usdc), address(0), BOND, LIVENESS);
        vm.expectRevert("OutcomeOracle: zero liveness");
        new OutcomeOracle(address(usdc), owner, BOND, 0);
    }

    function test_revert_setDefaultLivenessZero() public {
        vm.prank(owner);
        vm.expectRevert("OutcomeOracle: zero liveness");
        oracle.setDefaultLiveness(0);
    }

    /// @notice An in-flight assertion keeps the liveness captured at assert time,
    ///         even if the owner later changes the default.
    function test_livenessCapturedAtAssertTime() public {
        _assert(true); // captures LIVENESS
        vm.prank(owner);
        oracle.setDefaultLiveness(10); // shorten default AFTER assertion
        vm.warp(block.timestamp + 10);
        assertFalse(oracle.isFinalizable(MARKET), "must still honor captured window");
        vm.expectRevert("OutcomeOracle: window open");
        oracle.finalize(MARKET);
        vm.warp(block.timestamp + LIVENESS);
        oracle.finalize(MARKET);
        (bool resolved,) = oracle.getResolvedOutcome(MARKET);
        assertTrue(resolved);
    }

    /// @notice The disputer matches the bond CAPTURED at assert time, not the
    ///         current bondAmount (which the owner may have changed).
    function test_bondCapturedAtAssertTime() public {
        _assert(true); // captures bond = BOND
        vm.prank(owner);
        oracle.setBondAmount(1_000e6); // raise bond AFTER assertion
        uint256 balBefore = usdc.balanceOf(disputer);
        vm.prank(disputer);
        oracle.dispute(MARKET);
        assertEq(usdc.balanceOf(disputer), balBefore - BOND, "dispute must match captured bond");
    }

    function test_multipleMarkets_independentState() public {
        bytes32 mA = keccak256("mA");
        bytes32 mB = keccak256("mB");
        vm.startPrank(proposer);
        oracle.assertOutcome(mA, true);
        oracle.assertOutcome(mB, false);
        vm.stopPrank();
        vm.warp(block.timestamp + LIVENESS);
        oracle.finalize(mA); // finalize only mA
        (bool rA, bool oA) = oracle.getResolvedOutcome(mA);
        (bool rB,) = oracle.getResolvedOutcome(mB);
        assertTrue(rA && oA, "mA resolved YES");
        assertFalse(rB, "mB still pending");
    }
}
