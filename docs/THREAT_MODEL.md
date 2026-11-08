# Threat model (testnet MVP)

## What Lethe protects

- **Pre-trade privacy.** Until the reveal phase, an order is a hash. Observers, MEV bots and the single Elysium
  sequencer cannot see side, price or size, so they cannot front-run, sandwich or copy it.
- **Fair execution.** Everyone filled in a round pays or receives the same price, and never worse than their limit.
- **Custody.** No admin or keeper can move user funds. Free balances are withdrawable at any time.

## What it does not protect

- **Post-trade privacy.** Reveals and fills are public. Addresses, amounts and prices are visible after the round.
- **Metadata.** The commit transaction reveals that an address is trading this round. Vault balances are public: an
  account holding only quote can only buy. Holding both tokens hides your side.
- **Reveal-phase selection.** A trader can watch earlier reveals and decide not to reveal their own order. The bond
  prices this option. Raise `bond` if it is abused.

## Risks and mitigations

| Risk | Mitigation | Residual |
| --- | --- | --- |
| Commit lands late, in a later round | `commit(round, hash)` reverts unless `round` is current | none |
| Order secret lost (cleared storage) | Secret saved before signing; reveal impossible without it | bond forfeited |
| Browser closed during reveal phase | Helper key reveals while the tab is open | bond forfeited if closed |
| Helper key leaked | Helper can only reveal/settle (permissionless anyway); holds a little gas | its gas balance |
| Round spam (fill 100 slots) | Bond per commit, forfeited if not revealed; min order size | attacker pays bonds; a determined attacker can block a round |
| Keeper down | `settle` is permissionless; the app settles its own rounds after 4 s | none for funds |
| Fee-on-transfer token | Deposits credit balance delta | pair tokens should be standard ERC-20 |
| Rounding | Buyers round up, sellers down, dust to treasury; fuzzed exact accounting | dust |
| Reentrancy | `nonReentrant` on every state-changing entry; `SafeERC20` | — |
| Timestamp drift | Phases are ≥ 10 s; the UI refuses to seal with < 2.5 s left | — |
| Sequencer censorship / downtime (Elysium) | Elysium documents forced inclusion via HyperEVM | rounds can be missed while the sequencer is down |

## Elysium trust assumptions (as documented, not independently verified)

Single sequencer at launch, permissioned validation (BoLD later), AnyTrust data availability with HyperEVM fallback.
A fast receipt is not settlement finality on HyperEVM. See [network-evidence.md](network-evidence.md).

## Release gates

1. **Local:** contract tests and fuzzing pass, and `scripts/e2e.mjs` passes. ✅ done for v1.
2. **Testnet:** verify chain ID 99801 live, dry-run deploy, operator approval, broadcast, verify source, record
   addresses, run the e2e flow against testnet.
3. **Mainnet (not started):** independent audit; verified canonical assets; reviewed bond/min/round parameters;
   monitoring for keeper balance, stalled rounds and RPC errors; incident runbook; explicit go decision.
