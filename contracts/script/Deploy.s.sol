// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../src/PolicyVault.sol";

/// @title Deploy — Foundry deployment script for PolicyVault
/// @notice Reads configuration from environment variables and broadcasts a deployment.
/// @dev Injective EVM testnet deployment flags:
///      forge script script/Deploy.s.sol \
///        --rpc-url $INJECTIVE_EVM_RPC_URL \
///        --legacy \
///        --with-gas-price 160000000 \
///        --broadcast
///
///      Environment variables required:
///        USDC_ADDRESS       — ERC-20 USDC token on Injective EVM testnet
///        TREASURY_ADDRESS   — Fee recipient
///        PLATFORM_FEE_BPS   — Fee in bps (e.g. 200 = 2%)
///        RELAYER            — Platform relayer address

// ─── Minimal Script base (mirrors forge-std/Script.sol) ─────────────────────
// forge-std is required at build time. When `forge install foundry-rs/forge-std`
// has been run, replace this with: import "forge-std/Script.sol";
abstract contract Script {
    // Cheatcode address per EIP-XXXX (Foundry convention)
    address internal constant VM_ADDRESS = address(uint160(uint256(keccak256("hevm cheat code"))));

    Vm internal constant vm = Vm(VM_ADDRESS);

    modifier broadcast() {
        vm.startBroadcast();
        _;
        vm.stopBroadcast();
    }
}

interface Vm {
    function startBroadcast() external;
    function stopBroadcast() external;
    function envAddress(string calldata key) external view returns (address);
    function envUint(string calldata key) external view returns (uint256);
}

// ─────────────────────────────────────────────────────────────────────────────

contract Deploy is Script {
    function run() external broadcast {
        address usdcAddr = vm.envAddress("USDC_ADDRESS");
        address treasuryAddr = vm.envAddress("TREASURY_ADDRESS");
        uint256 feeBps = vm.envUint("PLATFORM_FEE_BPS");
        address relayerAddr = vm.envAddress("RELAYER");

        new PolicyVault(
            usdcAddr,
            msg.sender,   // deployer becomes owner
            relayerAddr,
            treasuryAddr,
            uint16(feeBps)
        );
    }
}
