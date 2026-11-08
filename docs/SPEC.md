# Lethe auction specification (v1)

One immutable `LetheAuction` contract per token pair (`baseToken` / `quoteToken`). No owner, admin, pause or upgrade.

## Units

- `amount`: base-token base units.
- `price`: quote base units per `1e18` base base units. For tHYPE (18 dp) / tUSDC (6 dp), 30.5 tUSDC per tHYPE is
  `30_500_000`.
- Quote for a fill = `fill × price / 1e18`. Buyers round **up**, sellers round **down**. Dust goes to `treasury`.

## Vault

`balanceOf[trader][token]` is the free balance. `deposit`, `depositWithPermit` (EIP-2612; a front-run permit is
tolerated) and `withdraw` move tokens in and out. Deposits credit the amount actually received.

## Timing

Round `r` starts at `genesis + r × (commit + reveal)`. All phases are pure functions of `block.timestamp`:

| Phase | Window | Allowed |
| --- | --- | --- |
| Commit | `[start, start + commit)` | `commit(r, hash)`, `cancel(r, i)` |
| Reveal | `[start + commit, end)` | `reveal(r, i, …)` |
| Settleable | `≥ end`, not settled | `settle(r)` |
| Settled | after `settle` | nothing |

Rounds overlap only in the sense that round `r` can be settled while round `r + 1` is accepting commits.

## Orders

- **commit(round, hash):** `round` must equal `currentRound()` and be in Commit. Takes `bond` quote from the free
  balance. At most `maxOrdersPerRound` (≤ 200) per round.
- **cancel:** trader only, Commit phase only. Returns the bond. Cancelling leaks nothing, because no reveals exist yet.
- **reveal:** anyone holding the preimage, Reveal phase only. `hash` binds chain, contract, round, trader, side,
  price, amount and salt, so a revealer cannot alter or re-target the order. It returns the bond, then locks
  `ceil(amount × price / 1e18)` quote (buy) or `amount` base (sell) from the trader's free balance, and reverts if it
  can't. Requires `amount ≥ minBaseAmount`, `price > 0`, both `≤ uint128.max`.
- An order still `Committed` at settlement forfeits its bond to `treasury`. That cost is the price of the free option
  of not revealing.

## Clearing

Over revealed orders, for each candidate price `p` (every revealed limit price):

- `D(p)` = Σ buy amounts with `limit ≥ p`; `S(p)` = Σ sell amounts with `limit ≤ p`; `V(p) = min(D, S)`.

Choose `p*` maximising `V`. Break ties by the smallest `|D − S|`. If several prices remain tied, use the midpoint of
the lowest and highest tied candidates when the midpoint is equally good, otherwise the lowest. `V = 0` means no
trade, and every lock is returned.

## Allocation

- The **short** side (smaller of `D`, `S`) fills completely.
- The **long** side fills pro-rata: `fill_i = floor(amount_i × V / longTotal)`. The remainder `V − Σ fill_i` (fewer
  units than orders) is handed out in order of index, so both sides move exactly `V`.
- Ineligible orders (limit on the wrong side of `p*`) fill nothing and are fully refunded.
- Every filled trader trades at `p*`, never worse than their limit.

## Invariant

After every round is settled, the contract's token balances equal the sum of all vault balances (fuzz-tested). While
rounds are open, the difference equals the locked amounts plus unreturned bonds.

## Gas

A full 100-order round settles in about 4.8M gas (`test_fullRoundSettleGas`). Settlement is O(n²) in revealed orders,
bounded by `maxOrdersPerRound`.
