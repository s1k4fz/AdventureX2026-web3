// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";

import "../src/OutcomeOracle.sol";
import "../src/interfaces/IERC20.sol";

/// @dev Malicious bond token that re-enters the oracle during transferFrom.
///      Balances/allowance are always "sufficient" so the only failure surface
///      under test is the reentrancy guard.
contract ReentrantBondToken is IERC20 {
    OutcomeOracle public oracle;
    bytes32 public reentryMarket;
    bool private _entered;

    function arm(OutcomeOracle o, bytes32 market) external {
        oracle = o;
        reentryMarket = market;
    }

    function transferFrom(address, address, uint256) external override returns (bool) {
        if (address(oracle) != address(0) && !_entered) {
            _entered = true;
            // Attempt to re-enter a state-mutating, nonReentrant function.
            oracle.assertOutcome(reentryMarket, true);
        }
        return true;
    }

    // --- inert ERC-20 surface ---
    function transfer(address, uint256) external pure override returns (bool) {
        return true;
    }

    function approve(address, uint256) external pure override returns (bool) {
        return true;
    }

    function allowance(address, address) external pure override returns (uint256) {
        return type(uint256).max;
    }

    function balanceOf(address) external pure override returns (uint256) {
        return type(uint256).max;
    }

    function totalSupply() external pure override returns (uint256) {
        return 0;
    }

    function decimals() external pure override returns (uint8) {
        return 6;
    }
}

/// @title OutcomeOracleReentrancyTest — proves nonReentrant blocks re-entry
contract OutcomeOracleReentrancyTest is Test {
    address owner = address(0xA1);

    function test_reentrancy_blocked_onAssert() public {
        ReentrantBondToken bad = new ReentrantBondToken();
        OutcomeOracle oracle = new OutcomeOracle(address(bad), owner, 1e6, 300);
        bad.arm(oracle, keccak256("reentry-market"));

        // assertOutcome -> _safeTransferFrom -> token re-enters assertOutcome
        // -> nonReentrant reverts -> transferFrom reverts -> outer call reverts.
        vm.expectRevert();
        oracle.assertOutcome(keccak256("victim-market"), true);

        // Nothing was recorded for either market (the whole tx reverted).
        (,,,,, , OutcomeOracle.Status s1,) = oracle.assertions(keccak256("victim-market"));
        (,,,,, , OutcomeOracle.Status s2,) = oracle.assertions(keccak256("reentry-market"));
        assertEq(uint256(s1), uint256(OutcomeOracle.Status.None), "victim must be untouched");
        assertEq(uint256(s2), uint256(OutcomeOracle.Status.None), "reentry must be untouched");
    }
}
