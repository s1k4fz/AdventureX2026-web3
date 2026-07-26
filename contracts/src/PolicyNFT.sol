// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IPolicyVault.sol";

/// @notice Interface implemented by contracts that safely receive ERC-721 tokens.
interface IERC721Receiver {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data)
        external
        returns (bytes4);
}

/// @title PolicyNFT — transferable ERC-721 representation of a PolicyVault policy
/// @author xEngine
/// @notice A PolicyVault policy owner may mint exactly one NFT for an existing policy.
/// @dev tokenId is the uint256 representation of policyId. Metadata is served off-chain
///      from `baseURI + decimal(tokenId)`. The contract intentionally has no admin role,
///      burn function, enumeration extension, or mutable metadata configuration.
contract PolicyNFT {
    string public constant name = "xEngine Policy";
    string public constant symbol = "XPOL";

    bytes4 private constant _INTERFACE_ID_ERC165 = 0x01ffc9a7;
    bytes4 private constant _INTERFACE_ID_ERC721 = 0x80ac58cd;
    bytes4 private constant _INTERFACE_ID_ERC721_METADATA = 0x5b5e139f;

    IPolicyVault public immutable vault;
    string public baseURI;

    mapping(uint256 tokenId => address owner) private _owners;
    mapping(address owner => uint256 balance) private _balances;
    mapping(uint256 tokenId => address approved) private _tokenApprovals;
    mapping(address owner => mapping(address operator => bool approved)) private _operatorApprovals;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    constructor(IPolicyVault _vault, string memory _baseURI) {
        require(address(_vault) != address(0), "PolicyNFT: zero vault");
        require(address(_vault).code.length != 0, "PolicyNFT: vault has no code");

        bytes memory uri = bytes(_baseURI);
        require(uri.length != 0, "PolicyNFT: empty base URI");

        vault = _vault;
        baseURI = uri[uri.length - 1] == 0x2f ? _baseURI : string.concat(_baseURI, "/");
    }

    /// @notice Report ERC-165, ERC-721, and ERC-721 Metadata support.
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == _INTERFACE_ID_ERC165 || interfaceId == _INTERFACE_ID_ERC721
            || interfaceId == _INTERFACE_ID_ERC721_METADATA;
    }

    /// @notice Mint the NFT corresponding to an existing PolicyVault policy.
    /// @dev Active and settled policies are both eligible. Only the policy's recorded
    ///      user may mint, and the deterministic token ID prevents duplicate mints.
    function mint(bytes32 policyId) external returns (uint256 tokenId) {
        tokenId = uint256(policyId);
        // Application policy IDs are UUIDs encoded in the low 128 bits of a
        // bytes32. Restrict minting to that namespace so every tokenURI can be
        // reversed by the metadata service.
        require(tokenId <= type(uint128).max, "PolicyNFT: unsupported policy id");
        require(_owners[tokenId] == address(0), "PolicyNFT: already minted");

        (address policyUser,,,,) = vault.policies(policyId);
        require(policyUser != address(0), "PolicyNFT: policy not found");
        require(msg.sender == policyUser, "PolicyNFT: caller is not policy user");

        _owners[tokenId] = policyUser;
        unchecked {
            ++_balances[policyUser];
        }

        emit Transfer(address(0), policyUser, tokenId);
    }

    function balanceOf(address owner) external view returns (uint256) {
        require(owner != address(0), "PolicyNFT: zero owner");
        return _balances[owner];
    }

    function ownerOf(uint256 tokenId) public view returns (address) {
        address owner = _owners[tokenId];
        require(owner != address(0), "PolicyNFT: nonexistent token");
        return owner;
    }

    function approve(address to, uint256 tokenId) external {
        address owner = ownerOf(tokenId);
        require(to != owner, "PolicyNFT: approval to current owner");
        require(msg.sender == owner || _operatorApprovals[owner][msg.sender], "PolicyNFT: caller cannot approve");

        _tokenApprovals[tokenId] = to;
        emit Approval(owner, to, tokenId);
    }

    function getApproved(uint256 tokenId) external view returns (address) {
        ownerOf(tokenId);
        return _tokenApprovals[tokenId];
    }

    function setApprovalForAll(address operator, bool approved) external {
        require(operator != msg.sender, "PolicyNFT: approve to caller");
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function isApprovedForAll(address owner, address operator) external view returns (bool) {
        return _operatorApprovals[owner][operator];
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        address owner = ownerOf(tokenId);
        require(from == owner, "PolicyNFT: incorrect owner");
        require(to != address(0), "PolicyNFT: transfer to zero");
        require(_isAuthorized(owner, msg.sender, tokenId), "PolicyNFT: caller not authorized");

        // A token-level approval never survives a transfer, including a self-transfer.
        delete _tokenApprovals[tokenId];

        if (from != to) {
            unchecked {
                --_balances[from];
                ++_balances[to];
            }
            _owners[tokenId] = to;
        }

        emit Transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        safeTransferFrom(from, to, tokenId, "");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) public {
        transferFrom(from, to, tokenId);
        require(_checkOnERC721Received(msg.sender, from, to, tokenId, data), "PolicyNFT: unsafe recipient");
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        ownerOf(tokenId);
        return string.concat(baseURI, _toString(tokenId));
    }

    function _isAuthorized(address owner, address spender, uint256 tokenId) private view returns (bool) {
        return spender == owner || _tokenApprovals[tokenId] == spender || _operatorApprovals[owner][spender];
    }

    function _checkOnERC721Received(address operator, address from, address to, uint256 tokenId, bytes memory data)
        private
        returns (bool)
    {
        if (to.code.length == 0) return true;

        try IERC721Receiver(to).onERC721Received(operator, from, tokenId, data) returns (bytes4 retval) {
            return retval == IERC721Receiver.onERC721Received.selector;
        } catch (bytes memory reason) {
            if (reason.length == 0) return false;
            assembly ("memory-safe") {
                revert(add(reason, 0x20), mload(reason))
            }
        }
    }

    function _toString(uint256 value) private pure returns (string memory) {
        if (value == 0) return "0";

        uint256 digits;
        uint256 remaining = value;
        while (remaining != 0) {
            unchecked {
                ++digits;
            }
            remaining /= 10;
        }

        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            unchecked {
                --digits;
            }
            buffer[digits] = bytes1(uint8(48 + (value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}
