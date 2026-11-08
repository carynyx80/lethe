# Lethe

**Trade sealed. Clear fair.**

Lethe is a sealed-order batch-auction exchange on [Elysium](https://elysium.kinetiq.xyz/docs/what-is-elysium), Kinetiq's
EVM Layer 2 for the Hyperliquid ecosystem. Orders stay hidden until the round closes, then everyone who trades fills
at one clearing price. Nobody, including the sequencer, can see an order in time to trade ahead of it.

> **Status: testnet MVP.** Runs on Elysium testnet (chain 99801) and a local devnet with valueless test tokens.
> Unaudited. Mainnet is disabled in code until a separate, reviewed release. See [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).

## How a round works

```
 ┌──────────── round n (30 s) ────────────┐
 │  SEAL 20 s               │ REVEAL 10 s  │──► settle(n): one price, everyone fills
 └──────────────────────────┴──────────────┘
```

1. **Seal.** The trader commits `keccak256(chainId, auction, round, trader, side, price, amount, salt)` plus a small
   bond. Only the hash is on-chain.
2. **Reveal.** The browser reveals automatically when the reveal phase opens, using a gas-only helper key. Revealing
   returns the bond and locks the order's funds.
3. **Settle.** Anyone (normally the keeper) calls `settle(n)`. The contract picks the price that matches the most
   volume, fills the short side completely and the long side pro-rata. Unrevealed orders forfeit their bond.

Full rules are in [docs/SPEC.md](docs/SPEC.md).

## Repository

| Path | What |
| --- | --- |
| `contracts/` | Foundry: `LetheAuction.sol`, `TestToken.sol`, tests (unit + fuzz), dry-run-first deploy script |
| `apps/web/` | Next.js + wagmi/viem trading app |
| `services/keeper/` | Settles finished rounds (permissionless; the app settles too if the keeper is down) |
| `packages/shared/` | Generated ABIs, chain definitions, price/commitment helpers |
| `scripts/` | `local.sh` (one-command devnet), `e2e.mjs` (two-trader browser test) |
| `docs/` | Spec, threat model, Elysium network evidence |

## Run it locally

Needs Node 22+ and [Foundry](https://getfoundry.sh).

```bash
npm install
git submodule update --init --recursive
npm run local
```

`npm run local` starts anvil, deploys, writes `apps/web/.env.local` and runs the keeper. Then, in another terminal:

```bash
npm run dev
```

Open http://localhost:3000. In your wallet, add network `http://127.0.0.1:8545` (chain 31337) and import anvil dev
key #1 or #2 (public test keys, never use them elsewhere).

### Tests

```bash
npm run test:contracts
npm run typecheck
node scripts/e2e.mjs
```

`scripts/e2e.mjs` needs the local devnet and app running, plus Playwright.

## Deploy to Elysium testnet

Nothing is broadcast without an explicit decision by the operator.

1. Fund a deployer with testnet HYPE (Elysium faucet, or bridge from HyperEVM testnet).
2. Dry run, which simulates only and verifies the RPC really is chain 99801:
   ```bash
   cd contracts && EXPECTED_CHAIN_ID=99801 ELYSIUM_RPC_URL=https://testnet-rpc.elysium.kinetiq.xyz \
     forge script script/Deploy.s.sol --rpc-url elysium_testnet --sender <deployer>
   ```
3. Broadcast with an encrypted keystore (never a raw key in env or chat):
   ```bash
   ... --broadcast --keystore $DEPLOYER_KEYSTORE_PATH
   ```
4. Record `contracts/deployments/99801.json`. Set `NEXT_PUBLIC_CHAIN_ID=99801` and `NEXT_PUBLIC_AUCTION_ADDRESS` for
   the web app, and the keeper's env (`services/keeper/.env.example`).

The web app is a static Next.js build and deploys to Vercel or any static host.

## Mainnet

Elysium mainnet (chain 99901) is scheduled for 9 Nov 2026. Lethe keeps it disabled: the deploy script refuses it and
the app only knows testnet and local. A mainnet release needs real assets (verified WHYPE/USDC addresses), an
independent audit, and the go/no-go checks in [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).
