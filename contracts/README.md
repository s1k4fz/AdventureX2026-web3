# xEngine 差分机 — Smart Contracts

> Insurance-style investment dApp on **Injective EVM testnet** (chainId 1439).

## Overview

`PolicyVault.sol` is the core on-chain engine.  Users pay a USDC premium to open a *policy* — a basket of YES/NO positions referencing real Polymarket markets.  The platform vault is the sole counterparty; a trusted relayer settles policies with off-chain resolution results.

## V1 Trust Model & Disclaimer

| Aspect | Detail |
|--------|--------|
| Counterparty | Platform vault (faucet-funded). The platform bears payout risk. |
| Resolution | A platform-controlled relayer hot-key pushes Polymarket outcomes on-chain. |
| Insurance? | **NO.** This is a productized metaphor, NOT regulated insurance. |
| Upgradability | None. V1 is immutable once deployed. |

Users trust the platform to: (1) fund the vault honestly, (2) relay truthful outcomes, (3) maintain solvency.

---

## Shares / MaxPayout Math

```
Given:
  premium      — total USDC paid by the user
  feeBps       — platform fee (e.g. 200 = 2%)
  netPremium   = premium - premium * feeBps / 10000
  weightBps_i  — proportion of netPremium allocated to position i (must sum to 10000)
  entryPriceBps_i — probability-based entry price in bps, range (0, 10000]

For each position i:
  allocated_i  = netPremium * weightBps_i / 10000
  shares_i     = allocated_i * 10000 / entryPriceBps_i

maxPayout      = Σ shares_i   (worst-case payout if ALL legs win)
```

### Worked Numeric Example

```
premium       = 1000 USDC (= 1_000_000_000 in 6-decimal units)
feeBps        = 200 (2%)
fee           = 1000e6 * 200 / 10000 = 20_000_000 (20 USDC → treasury)
netPremium    = 980_000_000

Position 0: sideYes=true, entryPriceBps=6000, weightBps=5000
  allocated_0 = 980_000_000 * 5000 / 10000 = 490_000_000
  shares_0    = 490_000_000 * 10000 / 6000 = 816_666_666

Position 1: sideYes=false, entryPriceBps=4000, weightBps=5000
  allocated_1 = 980_000_000 * 5000 / 10000 = 490_000_000
  shares_1    = 490_000_000 * 10000 / 4000 = 1_225_000_000

maxPayout     = 816_666_666 + 1_225_000_000 = 2_041_666_666 (~2041.67 USDC)
```

**Reserve Invariant:** `freeLiquidity = usdc.balanceOf(vault) - reserved ≥ 0` at all times.  
Opening a policy requires `freeLiquidity ≥ maxPayout`.  
Settlement releases the **full** `maxPayout` from `reserved` (regardless of actual payout).

---

## Repository Structure

```
contracts/
├── foundry.toml
├── .gitignore
├── README.md
├── lib/                  # Empty — no external dependencies in src/
├── src/
│   ├── interfaces/
│   │   ├── IERC20.sol        # Minimal ERC-20 interface (inline, no OZ)
│   │   └── IPolicyVault.sol  # Minimal getter used by PolicyNFT
│   ├── MockUSDC.sol     # Test-only 6-decimal ERC-20 with public mint
│   ├── PolicyNFT.sol    # Transferable ERC-721 policy credential
│   └── PolicyVault.sol  # Core contract
├── script/
│   ├── Deploy.s.sol     # PolicyVault deploy script
│   └── DeployNFT.s.sol  # PolicyNFT deploy script
└── test/
    ├── PolicyNFT.t.sol   # ERC-721 and Vault integration tests
    └── PolicyVault.t.sol # Forge tests (requires forge-std)
```

---

## Build / Test / Deploy

### Prerequisites

```bash
# Install Foundry (https://book.getfoundry.sh/getting-started/installation)
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Install forge-std (test dependency only — src/ is self-contained)
cd contracts
forge install foundry-rs/forge-std
```

### Compile

```bash
forge build
```

### Test

```bash
forge test -vvv
```

### Deploy to Injective EVM Testnet

```bash
export INJECTIVE_EVM_RPC_URL="https://evm-testnet.injective.network"
export USDC_ADDRESS="0x..."        # MTS USDC on Injective EVM testnet
export TREASURY_ADDRESS="0x..."
export PLATFORM_FEE_BPS=200
export RELAYER="0x..."
export PRIVATE_KEY="0x..."

forge script script/Deploy.s.sol \
  --rpc-url $INJECTIVE_EVM_RPC_URL \
  --private-key $PRIVATE_KEY \
  --legacy \
  --with-gas-price 160000000 \
  --broadcast
```

> **Note:** Injective EVM testnet uses legacy transactions (no EIP-1559). `--legacy` and `--with-gas-price 160000000` (160 gwei) are required.

### Deploy PolicyNFT

Deploy the backend metadata route and public frontend `/nft/:tokenId` page first.
`NFT_BASE_URI` is immutable and must be the absolute public prefix ending at
`/api/v1/policies/nft/metadata` (the contract normalizes one trailing slash).

```bash
export POLICY_VAULT_ADDRESS="0x..."
export NFT_BASE_URI="https://api.example.com/api/v1/policies/nft/metadata"

forge script script/DeployNFT.s.sol:DeployNFT \
  --rpc-url "$INJECTIVE_EVM_RPC_URL" \
  --private-key "$PRIVATE_KEY" \
  --legacy \
  --with-gas-price 160000000 \
  --broadcast
```

`DeployNFT` rejects any chain other than chainId `1439`. The transaction type
and gas price are controlled by Forge, so the two explicit CLI flags remain
mandatory. After deployment, read back `vault()`, `baseURI()`, bytecode, and
ERC-721 interface support before setting backend `POLICY_NFT_ADDRESS` and
frontend `VITE_POLICY_NFT_ADDRESS` to the same address.

---

## Dependency-Free Design

All source files under `src/` are fully self-contained:
- No OpenZeppelin imports.
- Inline `IERC20` interface.
- Inline reentrancy guard, access-control modifiers, and SafeERC20-style low-level call wrappers.

The **only** external dependency is `forge-std` used by `test/` and `script/` — this is standard Foundry practice and is fetched once with `forge install`.

---

## License

MIT
