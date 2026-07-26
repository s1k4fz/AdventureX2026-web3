// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import "../src/PolicyVault.sol";
import "../src/MockUSDC.sol";

/// @title TestnetE2E — Injective EVM testnet end-to-end functional test.
/// @notice Deploys MockUSDC + PolicyVault, funds the pool, opens a 2-leg policy,
///         settles it, and ASSERTS the exact share/payout/reserve math on-chain.
///         owner = relayer = treasury = deployer (MVP single hot key).
/// @dev Run (from contracts/):
///   forge script script/TestnetE2E.s.sol:TestnetE2E \
///     --rpc-url $INJECTIVE_EVM_RPC_URL --broadcast --legacy \
///     --with-gas-price 160000000 --slow -vvv
///   Requires env DEPLOYER_PRIVATE_KEY. The real MTS USDC address is not yet
///   confirmed, so a MockUSDC is deployed to exercise the full flow under our key.
///
/// Worked math (premium=1000 USDC, feeBps=100 => fee=10, net=990):
///   leg0: YES  entry 4000bps weight 6000bps -> alloc 594 -> shares 1485
///   leg1: NO   entry 6000bps weight 4000bps -> alloc 396 -> shares  660
///   maxPayout = 2145 ; settle outcomes [YES, YES] => leg0 wins => payout 1485.
contract TestnetE2E is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address me = vm.addr(pk);

        vm.startBroadcast(pk);

        MockUSDC usdc = new MockUSDC();
        PolicyVault vault = new PolicyVault(address(usdc), me, me, me, 100);

        usdc.mint(me, 1000000e6);
        usdc.approve(address(vault), type(uint256).max);
        vault.fundPool(100000e6);

        PolicyVault.PositionInput[] memory pos = new PolicyVault.PositionInput[](2);
        pos[0] = PolicyVault.PositionInput({
            marketRef: keccak256("mktA"),
            sideYes: true,
            entryPriceBps: 4000,
            weightBps: 6000
        });
        pos[1] = PolicyVault.PositionInput({
            marketRef: keccak256("mktB"),
            sideYes: false,
            entryPriceBps: 6000,
            weightBps: 4000
        });

        bytes32 pid = keccak256("policy-e2e-1");
        vault.openPolicy(pid, pos, 1000e6, uint64(block.timestamp + 30 days));

        uint256 reservedAfterOpen = vault.reserved();

        bool[] memory outc = new bool[](2);
        outc[0] = true; // market A resolved YES -> leg0 (YES) wins
        outc[1] = true; // market B resolved YES -> leg1 (NO) loses

        uint256 balBefore = usdc.balanceOf(me);
        vault.settlePolicy(pid, outc);
        uint256 payout = usdc.balanceOf(me) - balBefore;

        vm.stopBroadcast();

        console2.log("MockUSDC:", address(usdc));
        console2.log("PolicyVault:", address(vault));
        console2.log("reservedAfterOpen:", reservedAfterOpen);
        console2.log("payout:", payout);
        console2.log("reservedAfterSettle:", vault.reserved());

        require(reservedAfterOpen == 2145e6, "maxPayout/reserve mismatch");
        require(payout == 1485e6, "payout mismatch");
        require(vault.reserved() == 0, "reserve not released");
    }
}
