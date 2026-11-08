"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import clsx from "clsx";
import { useAccount } from "wagmi";
import { fromPrice, pretty } from "@lethe/shared";
import type { Clock, Market } from "@/lib/market";
import { useOrderStore, type LocalOrder } from "@/lib/orders";
import { useOutcome } from "@/lib/outcome";
import { cancelOrder } from "@/lib/actions";
import { friendlyError } from "@/lib/tx";
import { toast } from "@/lib/toast";
import { activeChain } from "@/lib/wagmi";

export function MyOrders({ market, clock }: { market?: Market; clock?: Clock }) {
  const { address } = useAccount();
  const all = useOrderStore((s) => s.orders);
  const remove = useOrderStore((s) => s.remove);
  const [showAll, setShowAll] = useState(false);
  const mine = all.filter(
    (o) =>
      market &&
      o.chainId === activeChain.id &&
      o.auction.toLowerCase() === market.auction.toLowerCase() &&
      (!address || o.trader.toLowerCase() === address.toLowerCase()),
  );
  const shown = showAll ? mine : mine.slice(0, 6);

  return (
    <section className="card p-5 sm:p-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold">Your orders</h2>
        <span className="text-xs text-muted">Saved privately in this browser</span>
      </div>
      {mine.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
          No orders yet. Seal one and it shows up here, then gets revealed and settled for you.
        </div>
      ) : (
        <ul className="divide-y divide-line">
          <AnimatePresence initial={false}>
            {shown.map((o) => (
              <motion.li
                key={o.key}
                layout
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
              >
                <OrderRow o={o} market={market!} clock={clock} onDismiss={() => remove(o.key)} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      {mine.length > 6 && (
        <button className="mt-3 w-full text-center text-xs font-medium text-muted hover:text-fg" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show fewer" : `Show all ${mine.length}`}
        </button>
      )}
    </section>
  );
}

function OrderRow({ o, market, clock, onDismiss }: { o: LocalOrder; market: Market; clock?: Clock; onDismiss: () => void }) {
  const { data: outcome } = useOutcome(o, market);
  const [cancelling, setCancelling] = useState(false);
  const amount = BigInt(o.amount);
  const price = BigInt(o.price);
  const priceDec = market.quote.decimals + 18 - market.base.decimals;
  const canCancel =
    o.state === "sealed" && clock?.phase === "commit" && clock.round.toString() === o.round && clock.secondsLeft > 2;

  let chip: { label: string; tone: string };
  let detail: React.ReactNode = null;
  switch (o.state) {
    case "sealing":
      chip = { label: "Sealing…", tone: "seal" };
      break;
    case "sealed":
      chip = { label: "Sealed 🔒", tone: "seal" };
      detail = o.note ?? "Hidden from everyone until the reveal phase.";
      break;
    case "revealing":
      chip = { label: "Revealing…", tone: "reveal" };
      break;
    case "cancelled":
      chip = { label: "Cancelled", tone: "muted" };
      detail = "Bond returned.";
      break;
    case "failed":
      chip = { label: outcome?.kind === "forfeited" ? "Bond forfeited" : "Not revealed", tone: "sell" };
      detail = o.note;
      break;
    default: {
      // revealed: show the settlement outcome
      if (!outcome || outcome.kind === "pending") {
        chip = { label: "Clearing…", tone: "reveal" };
        detail = "Revealed. Waiting for the round to settle.";
      } else if (outcome.kind === "filled") {
        chip = { label: outcome.partial ? "Partly filled" : "Filled", tone: o.isBuy ? "buy" : "sell" };
        detail = (
          <>
            {o.isBuy ? "Bought" : "Sold"} <b className="num font-medium text-fg">{pretty(outcome.base, market.base.decimals, 6)}</b>{" "}
            {market.base.symbol} at <b className="num font-medium text-fg">{fromPrice(outcome.price, market.base.decimals, market.quote.decimals)}</b>{" "}
            {market.quote.symbol}
            {outcome.partial && ". The rest was returned to your Lethe balance"}.
          </>
        );
      } else if (outcome.kind === "unfilled") {
        chip = { label: "Not filled", tone: "muted" };
        detail =
          outcome.clearingPrice > 0n
            ? `Cleared at ${fromPrice(outcome.clearingPrice, market.base.decimals, market.quote.decimals)}, outside your limit. Funds returned.`
            : "No matching orders this round. Funds returned.";
      } else {
        chip = { label: "Bond forfeited", tone: "sell" };
      }
    }
  }

  const tones: Record<string, string> = {
    seal: "bg-seal/12 text-seal",
    reveal: "bg-reveal/12 text-reveal",
    buy: "bg-buy/12 text-buy",
    sell: "bg-sell/12 text-sell",
    muted: "bg-panel-2 text-muted",
  };
  const settledish = o.state === "cancelled" || o.state === "failed" || (outcome && outcome.kind !== "pending");

  return (
    <div className="flex items-start gap-3 py-3">
      <div
        className={clsx(
          "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold",
          o.isBuy ? "bg-buy/12 text-buy" : "bg-sell/12 text-sell",
        )}
      >
        {o.isBuy ? "B" : "S"}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="num text-sm font-medium">
            {o.isBuy ? "Buy" : "Sell"} {pretty(amount, market.base.decimals, 6)} {market.base.symbol}
          </span>
          <span className="num text-xs text-muted">
            {o.isBuy ? "≤" : "≥"} {pretty(price, priceDec, 4)} {market.quote.symbol}
          </span>
          <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-semibold", tones[chip.tone])}>{chip.label}</span>
        </div>
        {detail && <p className="mt-1 text-xs leading-relaxed text-muted">{detail}</p>}
        <div className="mt-1 flex gap-3 text-[11px] text-faint">
          <span className="num">Round #{o.round}</span>
          {o.commitTx && <TxLink hash={o.commitTx} label="sealed" />}
          {o.revealTx && <TxLink hash={o.revealTx} label="revealed" />}
        </div>
      </div>
      {canCancel && (
        <button
          disabled={cancelling}
          onClick={async () => {
            setCancelling(true);
            try {
              await cancelOrder(market, o);
              toast.push({ tone: "success", title: "Order cancelled", body: "Your bond is back in your Lethe balance." });
            } catch (e) {
              toast.push({ tone: "error", title: "Couldn't cancel", body: friendlyError(e) });
            } finally {
              setCancelling(false);
            }
          }}
          className="shrink-0 rounded-full border border-line px-3 py-1 text-xs text-muted hover:border-sell/60 hover:text-sell"
        >
          {cancelling ? "…" : "Cancel"}
        </button>
      )}
      {settledish && (
        <button onClick={onDismiss} className="shrink-0 text-faint hover:text-muted" aria-label="Remove from list" title="Remove from list">
          ×
        </button>
      )}
    </div>
  );
}

function TxLink({ hash, label }: { hash: string; label: string }) {
  const explorer = activeChain.blockExplorers?.default.url;
  if (!explorer) return <span className="num">{label}</span>;
  return (
    <a className="hover:text-muted hover:underline" href={`${explorer}/tx/${hash}`} target="_blank" rel="noreferrer">
      {label} ↗
    </a>
  );
}
