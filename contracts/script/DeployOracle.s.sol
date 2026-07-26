// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../src/OutcomeOracle.sol";
import "../src/PolicyVault.sol";

/// @title DeployOracle — deploy OutcomeOracle and wire it into an existing PolicyVault
/// @notice Deploys the optimistic outcome oracle and points the already-deployed
///         PolicyVault at it via setOutcomeOracle (owner-only, so the broadcaster
///         must be the vault owner — deployer == owner in the MVP single-key model).
/// @dev Injective EVM testnet deployment flags:
///      forge script script/DeployOracle.s.sol \
///        --rpc-url $INJECTIVE_EVM_RPC_URL \
///        --legacy \
///        --with-gas-price 160000000 \
///        --broadcast
///
///      Environment variables required:
///        USDC_ADDRESS           — ERC-20 USDC (bond token) on Injective EVM testnet
///        POLICY_VAULT_ADDRESS   — already-deployed PolicyVault to wire
///        ORACLE_BOND            — bond per assertion (USDC base units, e.g. 10000000)
///        ORACLE_LIVENESS        — challenge window in seconds (e.g. 300)

// ─── Minimal Script base (mirrors script/Deploy.s.sol) ─────────────────────────
abstract contract Script {
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

contract DeployOracle is Script {
    function run() external broadcast {
        address usdcAddr = vm.envAddress("USDC_ADDRESS");
        address vaultAddr = vm.envAddress("POLICY_VAULT_ADDRESS");
        uint256 bond = vm.envUint("ORACLE_BOND");
        uint256 liveness = vm.envUint("ORACLE_LIVENESS");

        // Deployer becomes the oracle owner (dispute arbiter).
        OutcomeOracle oracle = new OutcomeOracle(usdcAddr, msg.sender, bond, uint64(liveness));

        // Wire the vault to read from this oracle (requires deployer == vault owner).
        PolicyVault(vaultAddr).setOutcomeOracle(address(oracle));
    }
}
