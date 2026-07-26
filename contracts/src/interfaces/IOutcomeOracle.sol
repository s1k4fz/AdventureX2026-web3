// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IOutcomeOracle — read interface for binary market outcome resolution
/// @notice PolicyVault reads finalized outcomes from an OutcomeOracle at settlement.
///         Dependency-free, mirrors the IERC20 interface style used across src/.
interface IOutcomeOracle {
    /// @notice Whether a market's outcome has been finalized on-chain, and if so
    ///         which side won.
    /// @param marketRef The market reference (bytes32 conditionId as stored on-chain).
    /// @return resolved True if the outcome is finalized (Resolved status).
    /// @return outcomeYes True if YES won, false if NO won. Only meaningful if resolved.
    function getResolvedOutcome(bytes32 marketRef)
        external
        view
        returns (bool resolved, bool outcomeYes);
}
