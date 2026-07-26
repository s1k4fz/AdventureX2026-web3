// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../src/PolicyNFT.sol";

/// @title DeployNFT — Foundry deployment script for PolicyNFT
/// @notice Reads the existing PolicyVault address and public metadata base URL
///         from environment variables, then broadcasts a PolicyNFT deployment.
/// @dev Injective EVM testnet deployment flags:
///      forge script script/DeployNFT.s.sol \
///        --rpc-url $INJECTIVE_EVM_RPC_URL \
///        --private-key $PRIVATE_KEY \
///        --legacy \
///        --with-gas-price 160000000 \
///        --broadcast
///      The script rejects every chain except Injective EVM testnet (1439).
///      Foundry's transaction envelope still comes from the CLI, so `--legacy`
///      and the explicit gas-price flag above remain mandatory.
///
///      Environment variables required:
///        POLICY_VAULT_ADDRESS — already-deployed PolicyVault
///        NFT_BASE_URI         — complete public metadata prefix, for example
///                               https://api.example/api/v1/policies/nft/metadata/
///                               (PolicyNFT adds the trailing slash if omitted)

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
    function envString(string calldata key) external view returns (string memory);
}

contract DeployNFT is Script {
    function run() external broadcast returns (PolicyNFT nft) {
        require(block.chainid == 1439, "DeployNFT: wrong chain");
        address vaultAddr = vm.envAddress("POLICY_VAULT_ADDRESS");
        string memory metadataBaseURI = vm.envString("NFT_BASE_URI");

        nft = new PolicyNFT(IPolicyVault(vaultAddr), metadataBaseURI);
    }
}
