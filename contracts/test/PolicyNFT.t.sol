// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";

import "../src/MockUSDC.sol";
import "../src/PolicyNFT.sol";
import "../src/PolicyVault.sol";

contract ERC721ReceiverMock is IERC721Receiver {
    address public operator;
    address public from;
    uint256 public tokenId;
    bytes public data;

    function onERC721Received(address _operator, address _from, uint256 _tokenId, bytes calldata _data)
        external
        returns (bytes4)
    {
        operator = _operator;
        from = _from;
        tokenId = _tokenId;
        data = _data;
        return IERC721Receiver.onERC721Received.selector;
    }
}

contract WrongERC721Receiver is IERC721Receiver {
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return bytes4(0);
    }
}

contract RevertingERC721Receiver is IERC721Receiver {
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        revert("receiver rejected");
    }
}

contract NonERC721Receiver {}

/// @title PolicyNFTTest — ERC-721 compliance and PolicyVault integration tests
contract PolicyNFTTest is Test {
    MockUSDC internal usdc;
    PolicyVault internal vault;
    PolicyNFT internal nft;

    address internal owner = address(0xA1);
    address internal relayer = address(0xB2);
    address internal treasury = address(0xC3);
    address internal user = address(0xD4);
    address internal other = address(0xE5);
    address internal operator = address(0xF6);

    string internal constant BASE_URI = "https://api.example/api/v1/policies/nft/metadata/";

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    function setUp() public {
        usdc = new MockUSDC();
        vault = new PolicyVault(address(usdc), owner, relayer, treasury, 0);
        nft = new PolicyNFT(IPolicyVault(address(vault)), BASE_URI);

        usdc.mint(owner, 10_000e6);
        vm.startPrank(owner);
        usdc.approve(address(vault), type(uint256).max);
        vault.fundPool(10_000e6);
        vm.stopPrank();

        usdc.mint(user, 10_000e6);
        vm.prank(user);
        usdc.approve(address(vault), type(uint256).max);
    }

    function _openPolicy(bytes32 policyId) internal {
        PolicyVault.PositionInput[] memory positions = new PolicyVault.PositionInput[](1);
        positions[0] = PolicyVault.PositionInput({
            marketRef: keccak256("market-A"), sideYes: true, entryPriceBps: 5000, weightBps: 10000
        });

        vm.prank(user);
        vault.openPolicy(policyId, positions, 100e6, uint64(block.timestamp + 30 days));
    }

    function _mint(bytes32 policyId) internal returns (uint256 tokenId) {
        _openPolicy(policyId);
        vm.prank(user);
        tokenId = nft.mint(policyId);
    }

    // ─── Configuration and interfaces ────────────────────────────────────────

    function test_configurationAndInterfaceSupport() public view {
        assertEq(nft.name(), "Lemma Policy");
        assertEq(nft.symbol(), "LPOL");
        assertEq(address(nft.vault()), address(vault));
        assertEq(nft.baseURI(), BASE_URI);

        assertTrue(nft.supportsInterface(0x01ffc9a7), "ERC-165 unsupported");
        assertTrue(nft.supportsInterface(0x80ac58cd), "ERC-721 unsupported");
        assertTrue(nft.supportsInterface(0x5b5e139f), "ERC-721 metadata unsupported");
        assertFalse(nft.supportsInterface(0xffffffff), "invalid interface supported");
    }

    function test_constructorNormalizesMissingTrailingSlash() public {
        PolicyNFT normalized =
            new PolicyNFT(IPolicyVault(address(vault)), "https://api.example/api/v1/policies/nft/metadata");
        assertEq(normalized.baseURI(), BASE_URI);
    }

    function test_revert_constructorWithZeroVault() public {
        vm.expectRevert("PolicyNFT: zero vault");
        new PolicyNFT(IPolicyVault(address(0)), BASE_URI);
    }

    function test_revert_constructorWithVaultWithoutCode() public {
        vm.expectRevert("PolicyNFT: vault has no code");
        new PolicyNFT(IPolicyVault(address(0xBEEF)), BASE_URI);
    }

    function test_revert_constructorWithEmptyBaseURI() public {
        vm.expectRevert("PolicyNFT: empty base URI");
        new PolicyNFT(IPolicyVault(address(vault)), "");
    }

    // ─── Minting and metadata ────────────────────────────────────────────────

    function test_mintActivePolicyUsesDeterministicTokenId() public {
        bytes32 policyId = bytes32(uint256(12345));
        _openPolicy(policyId);

        vm.expectEmit(true, true, true, true, address(nft));
        emit Transfer(address(0), user, uint256(policyId));
        vm.prank(user);
        uint256 tokenId = nft.mint(policyId);

        assertEq(tokenId, uint256(policyId));
        assertEq(nft.ownerOf(tokenId), user);
        assertEq(nft.balanceOf(user), 1);
        assertEq(nft.tokenURI(tokenId), string.concat(BASE_URI, "12345"));
    }

    function test_mintSettledPolicy() public {
        bytes32 policyId = bytes32(uint256(88));
        _openPolicy(policyId);

        bool[] memory outcomes = new bool[](1);
        outcomes[0] = false;
        vm.prank(relayer);
        vault.settlePolicy(policyId, outcomes);

        vm.prank(user);
        nft.mint(policyId);
        assertEq(nft.ownerOf(uint256(policyId)), user);
    }

    function test_tokenURIHandlesTokenIdZero() public {
        uint256 tokenId = _mint(bytes32(0));
        assertEq(tokenId, 0);
        assertEq(nft.tokenURI(0), string.concat(BASE_URI, "0"));
    }

    function test_tokenURIHandlesMaxUuidTokenId() public {
        uint256 tokenId = _mint(bytes32(uint256(type(uint128).max)));
        assertEq(tokenId, type(uint128).max);
        assertEq(
            nft.tokenURI(tokenId),
            string.concat(BASE_URI, "340282366920938463463374607431768211455")
        );
    }

    function testFuzz_tokenURIUsesFullDecimalUuidTokenId(uint128 rawTokenId) public {
        uint256 tokenId = uint256(rawTokenId);
        _mint(bytes32(tokenId));
        assertEq(nft.tokenURI(tokenId), string.concat(BASE_URI, vm.toString(tokenId)));
    }

    function test_revert_mintPolicyOutsideUuidNamespace() public {
        bytes32 policyId = bytes32(uint256(type(uint128).max) + 1);
        _openPolicy(policyId);

        vm.prank(user);
        vm.expectRevert("PolicyNFT: unsupported policy id");
        nft.mint(policyId);
    }

    function test_revert_mintNonexistentPolicy() public {
        vm.prank(user);
        vm.expectRevert("PolicyNFT: policy not found");
        nft.mint(bytes32(uint256(404)));
    }

    function test_revert_mintByNonPolicyUser() public {
        bytes32 policyId = bytes32(uint256(1));
        _openPolicy(policyId);

        vm.prank(other);
        vm.expectRevert("PolicyNFT: caller is not policy user");
        nft.mint(policyId);
    }

    function test_revert_duplicateMint() public {
        bytes32 policyId = bytes32(uint256(2));
        _mint(policyId);

        vm.prank(user);
        vm.expectRevert("PolicyNFT: already minted");
        nft.mint(policyId);
    }

    function test_revert_queriesForNonexistentToken() public {
        vm.expectRevert("PolicyNFT: nonexistent token");
        nft.ownerOf(999);

        vm.expectRevert("PolicyNFT: nonexistent token");
        nft.getApproved(999);

        vm.expectRevert("PolicyNFT: nonexistent token");
        nft.tokenURI(999);
    }

    function test_revert_balanceOfZeroAddress() public {
        vm.expectRevert("PolicyNFT: zero owner");
        nft.balanceOf(address(0));
    }

    // ─── Approvals and transfers ─────────────────────────────────────────────

    function test_approvedAddressTransfersAndApprovalIsCleared() public {
        uint256 tokenId = _mint(bytes32(uint256(3)));

        vm.expectEmit(true, true, true, true, address(nft));
        emit Approval(user, other, tokenId);
        vm.prank(user);
        nft.approve(other, tokenId);
        assertEq(nft.getApproved(tokenId), other);

        vm.prank(other);
        nft.transferFrom(user, operator, tokenId);

        assertEq(nft.ownerOf(tokenId), operator);
        assertEq(nft.balanceOf(user), 0);
        assertEq(nft.balanceOf(operator), 1);
        assertEq(nft.getApproved(tokenId), address(0));
    }

    function test_operatorApprovalCanTransferAndBeRevoked() public {
        uint256 tokenId = _mint(bytes32(uint256(4)));

        vm.expectEmit(true, true, false, true, address(nft));
        emit ApprovalForAll(user, operator, true);
        vm.prank(user);
        nft.setApprovalForAll(operator, true);
        assertTrue(nft.isApprovedForAll(user, operator));

        vm.prank(operator);
        nft.transferFrom(user, other, tokenId);
        assertEq(nft.ownerOf(tokenId), other);

        vm.prank(user);
        nft.setApprovalForAll(operator, false);
        assertFalse(nft.isApprovedForAll(user, operator));
    }

    function test_operatorCanApproveTokenDelegate() public {
        uint256 tokenId = _mint(bytes32(uint256(40)));

        vm.prank(user);
        nft.setApprovalForAll(operator, true);
        vm.prank(operator);
        nft.approve(other, tokenId);
        vm.prank(other);
        nft.transferFrom(user, other, tokenId);

        assertEq(nft.ownerOf(tokenId), other);
        assertEq(nft.getApproved(tokenId), address(0));
    }

    function test_balancesRemainCorrectAcrossMultipleTokens() public {
        uint256 first = _mint(bytes32(uint256(41)));
        _mint(bytes32(uint256(42)));
        assertEq(nft.balanceOf(user), 2);

        vm.prank(user);
        nft.transferFrom(user, other, first);
        assertEq(nft.balanceOf(user), 1);
        assertEq(nft.balanceOf(other), 1);
    }

    function test_selfTransferPreservesBalanceAndClearsApproval() public {
        uint256 tokenId = _mint(bytes32(uint256(5)));
        vm.prank(user);
        nft.approve(other, tokenId);

        vm.expectEmit(true, true, true, true, address(nft));
        emit Transfer(user, user, tokenId);
        vm.prank(user);
        nft.transferFrom(user, user, tokenId);

        assertEq(nft.ownerOf(tokenId), user);
        assertEq(nft.balanceOf(user), 1);
        assertEq(nft.getApproved(tokenId), address(0));
    }

    function test_revert_invalidApprovals() public {
        uint256 tokenId = _mint(bytes32(uint256(6)));

        vm.prank(user);
        vm.expectRevert("PolicyNFT: approval to current owner");
        nft.approve(user, tokenId);

        vm.prank(other);
        vm.expectRevert("PolicyNFT: caller cannot approve");
        nft.approve(operator, tokenId);

        vm.prank(user);
        vm.expectRevert("PolicyNFT: approve to caller");
        nft.setApprovalForAll(user, true);
    }

    function test_revert_invalidTransfers() public {
        uint256 tokenId = _mint(bytes32(uint256(7)));

        vm.prank(other);
        vm.expectRevert("PolicyNFT: caller not authorized");
        nft.transferFrom(user, other, tokenId);

        vm.prank(user);
        vm.expectRevert("PolicyNFT: incorrect owner");
        nft.transferFrom(other, other, tokenId);

        vm.prank(user);
        vm.expectRevert("PolicyNFT: transfer to zero");
        nft.transferFrom(user, address(0), tokenId);
    }

    // ─── Safe transfers ──────────────────────────────────────────────────────

    function test_safeTransferToEOA() public {
        uint256 tokenId = _mint(bytes32(uint256(8)));
        vm.prank(user);
        nft.safeTransferFrom(user, other, tokenId);
        assertEq(nft.ownerOf(tokenId), other);
    }

    function test_safeTransferToReceiverForwardsOperatorAndData() public {
        uint256 tokenId = _mint(bytes32(uint256(9)));
        ERC721ReceiverMock receiver = new ERC721ReceiverMock();
        bytes memory data = hex"c0ffee";

        vm.prank(user);
        nft.approve(operator, tokenId);
        vm.prank(operator);
        nft.safeTransferFrom(user, address(receiver), tokenId, data);

        assertEq(nft.ownerOf(tokenId), address(receiver));
        assertEq(receiver.operator(), operator);
        assertEq(receiver.from(), user);
        assertEq(receiver.tokenId(), tokenId);
        assertEq(receiver.data(), data);
    }

    function test_revert_safeTransferToWrongReceiverRollsBack() public {
        uint256 tokenId = _mint(bytes32(uint256(10)));
        WrongERC721Receiver receiver = new WrongERC721Receiver();

        vm.prank(user);
        vm.expectRevert("PolicyNFT: unsafe recipient");
        nft.safeTransferFrom(user, address(receiver), tokenId);

        assertEq(nft.ownerOf(tokenId), user);
        assertEq(nft.balanceOf(user), 1);
    }

    function test_revert_safeTransferToNonReceiverRollsBack() public {
        uint256 tokenId = _mint(bytes32(uint256(11)));
        NonERC721Receiver receiver = new NonERC721Receiver();

        vm.prank(user);
        vm.expectRevert("PolicyNFT: unsafe recipient");
        nft.safeTransferFrom(user, address(receiver), tokenId);

        assertEq(nft.ownerOf(tokenId), user);
    }

    function test_safeTransferBubblesReceiverRevert() public {
        uint256 tokenId = _mint(bytes32(uint256(12)));
        RevertingERC721Receiver receiver = new RevertingERC721Receiver();

        vm.prank(user);
        vm.expectRevert("receiver rejected");
        nft.safeTransferFrom(user, address(receiver), tokenId);

        assertEq(nft.ownerOf(tokenId), user);
    }
}
