// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IERC20 — Minimal ERC-20 interface
/// @notice Dependency-free interface used by PolicyVault and MockUSDC.
interface IERC20 {
    // ─── Events ───────────────────────────────────────────────────────────────
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    // ─── View ─────────────────────────────────────────────────────────────────
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function decimals() external view returns (uint8);

    // ─── Mutative ─────────────────────────────────────────────────────────────
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}
