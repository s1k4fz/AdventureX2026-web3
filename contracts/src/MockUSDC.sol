// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IERC20.sol";

/// @title MockUSDC — Test/Local-only 6-decimal ERC-20
/// @notice This contract is for LOCAL Foundry tests only.
///         On testnet/mainnet, use the native MTS USDC contract.
/// @dev NOT for production. Anyone can mint; no supply cap.
contract MockUSDC is IERC20 {
    string public constant name = "Mock USDC";
    string public constant symbol = "mUSDC";
    uint8 public constant override decimals = 6;

    uint256 private _totalSupply;
    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;

    // ─── ERC-20 View ──────────────────────────────────────────────────────────

    function totalSupply() external view override returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view override returns (uint256) {
        return _balances[account];
    }

    function allowance(address owner_, address spender) external view override returns (uint256) {
        return _allowances[owner_][spender];
    }

    // ─── ERC-20 Mutative ──────────────────────────────────────────────────────

    function approve(address spender, uint256 amount) external override returns (bool) {
        _allowances[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        uint256 currentAllowance = _allowances[from][msg.sender];
        require(currentAllowance >= amount, "MockUSDC: allowance exceeded");
        unchecked {
            _allowances[from][msg.sender] = currentAllowance - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    // ─── Test Helper ──────────────────────────────────────────────────────────

    /// @notice Mint tokens to any address. TEST ONLY — no access control.
    function mint(address to, uint256 amount) external {
        _totalSupply += amount;
        _balances[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _transfer(address from, address to, uint256 amount) internal {
        require(from != address(0), "MockUSDC: transfer from zero");
        require(to != address(0), "MockUSDC: transfer to zero");
        require(_balances[from] >= amount, "MockUSDC: balance too low");
        unchecked {
            _balances[from] -= amount;
        }
        _balances[to] += amount;
        emit Transfer(from, to, amount);
    }
}
