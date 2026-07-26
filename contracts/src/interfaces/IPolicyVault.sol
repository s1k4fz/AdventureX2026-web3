// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IPolicyVault
/// @notice Minimal PolicyVault view surface required by PolicyNFT.
interface IPolicyVault {
    /// @notice Return the on-chain policy identified by `policyId`.
    /// @dev Matches the getter generated for PolicyVault.policies.
    function policies(bytes32 policyId)
        external
        view
        returns (address user, uint256 premium, uint256 maxPayout, uint64 coverageEnd, bool settled);
}
