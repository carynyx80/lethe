"use client";

import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import clsx from "clsx";
import { formatUnits, parseUnits } from "viem";
import { useAccount } from "wagmi";
import { buyLock, fromPrice, pretty, toPrice } from "@lethe/shared";
import type { Clock, Market } from "@/lib/market";
import type { Balances } from "@/lib/balances";
import { claimFaucet, deposit, sealOrder } from "@/lib/actions";
import { friendlyError } from "@/lib/tx";
import { toast } from "@/lib/toast";
import { activeChain } from "@/lib/wagmi";
import { WalletButton } from "./Header";
import { appConfig } from "@/lib/config";

const MIN_SECONDS_TO_SEAL = 2.5; // leave room for the wallet prompt + inclusion before the phase ends

/** Plain decimal string with at most 6 fraction digits, rounded down (input-friendly). */
function trimUnits(v: bigint, decimals: number): string {
  const [i, f = ""] = formatUnits(v, decimals).split(".");
  const frac = f.slice(0, 6).replace(/0+$/, "");
  return frac ? `${i}.${frac}` : (i ?? "0");
}

function safeParse(v: string, decimals: number): bigint | undefined {
  if (!v || !/^\d*\.?\d*$/.test(v) || v === ".") return undefined;
  try {
    return parseUnits(v, decimals);
  } catch {
    return undefined;
  }
}

export function OrderTicket({
  market,
  clock,
  balances,
  lastPrice,
  helperReady,
  onEnableHelper,
  refresh,
}: {
  market?: Market;
  clock?: Clock;
  balances?: Balances;
  lastPrice?: bigint;
  helperReady: boolean;
  onEnableHelper: () => void;
  refresh: () => void;
}) {
  const { address, isConnected, chainId } = useAccount();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amountStr, setAmountStr] = useState("");
  const [priceStr, setPriceStr] = useState("");
  const [busy, setBusy] = useState<string>();
  const isBuy = side === "buy";
  const clockRef = useRef(clock);
  clockRef.current = clock;

  const refPrice = useMemo(
    () => (market && lastPrice ? fromPrice(lastPrice, market.base.decimals, market.quote.decimals) : undefined),
    [market, lastPrice],
  );
  const priceShown = priceStr || refPrice || "";

  const amount = market ? safeParse(amountStr, market.base.decimals) : undefined;
  const price = market && priceShown ? safeParse(priceShown, market.quote.decimals + 18 - market.base.decimals) : undefined;

  const quoteNeeded = market && amount && price ? (isBuy ? buyLock(amount, price) : 0n) + market.bond : undefined;
  const baseNeeded = !isBuy && amount ? amount : 0n;
  const shortQuote = balances && quoteNeeded !== undefined ? quoteNeeded > balances.vaultQuote ? quoteNeeded - balances.vaultQuote : 0n : 0n;
  const shortBase = balances ? (baseNeeded > balances.vaultBase ? baseNeeded - balances.vaultBase : 0n) : 0n;
  const canCoverFromWallet =
    !!balances && shortQuote <= balances.walletQuote && shortBase <= balances.walletBase;
  const hasAnyFunds =
    !!balances && balances.walletBase + balances.walletQuote + balances.vaultBase + balances.vaultQuote > 0n;

  const sealOpen = clock?.phase === "commit" && clock.secondsLeft > MIN_SECONDS_TO_SEAL;
  const reopensIn = clock
    ? Math.ceil(clock.phase === "commit" ? clock.secondsLeft + (market?.revealSeconds ?? 0) : clock.secondsLeft)
    : 0;

  const nudge = (pct: number) => {
    if (!market || !price) return;
    const p = (price * BigInt(10_000 + pct * 100)) / 10_000n;
    setPriceStr(fromPrice(p, market.base.decimals, market.quote.decimals));
  };

  const fillMax = () => {
    if (!market || !balances) return;
    if (isBuy) {
      if (!price) return;
      const quoteAvail = balances.vaultQuote + balances.walletQuote;
      const spend = quoteAvail > market.bond ? quoteAvail - market.bond : 0n;
      setAmountStr(trimUnits((spend * 10n ** 18n) / price, market.base.decimals));
    } else {
      setAmountStr(trimUnits(balances.vaultBase + balances.walletBase, market.base.decimals));
    }
  };

  async function run() {
    if (!market || !address || !clock || amount === undefined || price === undefined) return;
    try {
      if (shortQuote > 0n) {
        setBusy(`Depositing ${market.quote.symbol}…`);
        await deposit(market, market.quote, address, shortQuote);
      }
      if (shortBase > 0n) {
        setBusy(`Depositing ${market.base.symbol}…`);
        await deposit(market, market.base, address, shortBase);
      }
      // deposits take time: re-read the live clock so we never seal into a round that has closed
      const now = clockRef.current;
      if (!now || now.phase !== "commit" || now.secondsLeft < MIN_SECONDS_TO_SEAL) {
        toast.push({ tone: "info", title: "Funds deposited", body: "This round just closed. Seal your order when the next one opens." });
        refresh();
        return;
      }
      setBusy("Confirm in your wallet…");
      const o = await sealOrder({ market, trader: address, round: now.round, isBuy, price, amount });
      toast.push({
        tone: "success",
        title: "Order sealed 🔒",
        body: `Round #${o.round}. Nobody can see it until the round closes${helperReady ? ". It reveals automatically." : "."}`,
      });
      setAmountStr("");
      refresh();
    } catch (e) {
      toast.push({ tone: "error", title: "Order not sealed", body: friendlyError(e) });
    } finally {
      setBusy(undefined);
    }
  }

  async function getTokens() {
    if (!market) return;
    try {
      setBusy(`Claiming ${market.quote.symbol}…`);
      await claimFaucet(market.quote);
      setBusy(`Claiming ${market.base.symbol}…`);
      await claimFaucet(market.base);
      toast.push({ tone: "success", title: "Test tokens received", body: "They're valueless and for testnet only." });
      refresh();
    } catch (e) {
      toast.push({ tone: "error", title: "Faucet failed", body: friendlyError(e) });
    } finally {
      setBusy(undefined);
    }
  }

  // --- the one primary button, which always says exactly what will happen next
  let cta: React.ReactNode;
  const btn = (label: string, onClick?: () => void, tone: "seal" | "buy" | "sell" | "muted" = "seal") => (
    <button
      disabled={!onClick || !!busy}
      onClick={onClick}
      className={clsx(
        "relative w-full overflow-hidden rounded-full py-3.5 text-[15px] font-semibold transition active:scale-[0.99] disabled:cursor-not-allowed",
        tone === "buy" && "bg-buy text-ink hover:brightness-110",
        tone === "sell" && "bg-sell text-ink hover:brightness-110",
        tone === "seal" && "bg-gradient-to-r from-seal-deep to-seal text-white hover:brightness-110",
        tone === "muted" && "bg-panel-2 text-muted",
        !onClick && tone !== "muted" && "opacity-50",
      )}
    >
      {busy ?? label}
    </button>
  );

  if (!market) cta = btn(appConfig.prelaunch ? "Opening soon · Mainnet coming" : "Market not configured", undefined, "muted");
  else if (!isConnected || chainId !== activeChain.id) cta = <WalletButton big />;
  else if (!balances) cta = btn("Loading balances…", undefined, "muted");
  else if (!hasAnyFunds) cta = btn("Get free test tokens", getTokens);
  else if (!sealOpen) cta = btn(`Sealing reopens in ${reopensIn}s`, undefined, "muted");
  else if (amount === undefined || amount === 0n) cta = btn("Enter an amount", undefined, "muted");
  else if (price === undefined || price === 0n) cta = btn("Enter a limit price", undefined, "muted");
  else if (amount < market.minBase)
    cta = btn(`Minimum ${pretty(market.minBase, market.base.decimals, 6)} ${market.base.symbol}`, undefined, "muted");
  else if (!canCoverFromWallet)
    cta = btn(`Not enough ${shortQuote > 0n ? market.quote.symbol : market.base.symbol}`, getTokens, "muted");
  else if (shortQuote > 0n || shortBase > 0n)
    cta = btn(`Deposit & seal ${side} order`, run, isBuy ? "buy" : "sell");
  else cta = btn(`Seal ${side} order`, run, isBuy ? "buy" : "sell");

  return (
    <section className="card p-5 sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold">
          {market ? `${market.base.symbol} / ${market.quote.symbol}` : "Trade"}
        </h2>
        {clock ? (
          <span
            className={clsx(
              "num flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
              clock.phase === "reveal" ? "bg-reveal/10 text-reveal" : "bg-seal/10 text-seal",
            )}
            aria-live="polite"
          >
            <span className={clsx("h-1.5 w-1.5 animate-pulse rounded-full", clock.phase === "reveal" ? "bg-reveal" : "bg-seal")} />
            {clock.phase === "commit" ? "Sealing" : clock.phase === "reveal" ? "Revealing" : "Opens"} ·{" "}
            {Math.max(0, Math.ceil(clock.secondsLeft))}s
          </span>
        ) : (
          <span className="text-xs text-muted">Sealed-bid · one price per round</span>
        )}
      </div>

      <div className="relative mb-4 grid grid-cols-2 rounded-full bg-panel-2 p-1">
        <motion.div
          layout
          className={clsx("absolute inset-y-1 w-[calc(50%-4px)] rounded-full", isBuy ? "left-1 bg-buy/15" : "left-[50%] bg-sell/15")}
          transition={{ type: "spring", stiffness: 500, damping: 40 }}
        />
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSide(s)}
            className={clsx(
              "relative z-10 rounded-full py-2 text-sm font-semibold capitalize transition",
              side === s ? (s === "buy" ? "text-buy" : "text-sell") : "text-muted hover:text-fg",
            )}
          >
            {s}
          </button>
        ))}
      </div>

      <Field
        label="Amount"
        unit={market?.base.symbol ?? ""}
        value={amountStr}
        onChange={setAmountStr}
        right={
          balances && (
            <button className="text-xs font-medium text-seal hover:underline" onClick={fillMax}>
              Max
            </button>
          )
        }
      />
      <Field
        label={isBuy ? "Pay at most (per token)" : "Accept at least (per token)"}
        unit={market?.quote.symbol ?? ""}
        value={priceShown}
        onChange={setPriceStr}
        right={
          <div className="flex gap-1">
            {[-1, 1].map((p) => (
              <button
                key={p}
                className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted hover:border-line-2 hover:text-fg"
                onClick={() => nudge(p)}
              >
                {p > 0 ? "+" : "−"}1%
              </button>
            ))}
          </div>
        }
      />

      <div className="my-4 space-y-1.5 rounded-2xl border border-line bg-panel-2/60 p-3.5 text-sm">
        <Row
          k="Locked when revealed"
          v={
            market && amount && price
              ? isBuy
                ? `${pretty(buyLock(amount, price), market.quote.decimals)} ${market.quote.symbol}`
                : `${pretty(amount, market.base.decimals, 6)} ${market.base.symbol}`
              : "—"
          }
        />
        <Row
          k="Seal bond (returned on reveal)"
          v={market ? `${pretty(market.bond, market.quote.decimals)} ${market.quote.symbol}` : "—"}
        />
        {balances && market && (shortQuote > 0n || shortBase > 0n) && canCoverFromWallet && (
          <Row
            k="Moved from your wallet first"
            v={
              <span className="text-warn">
                {shortQuote > 0n && `${pretty(shortQuote, market.quote.decimals)} ${market.quote.symbol}`}
                {shortQuote > 0n && shortBase > 0n && " + "}
                {shortBase > 0n && `${pretty(shortBase, market.base.decimals, 6)} ${market.base.symbol}`}
              </span>
            }
          />
        )}
      </div>

      {cta}
      <p className="mt-3 text-center text-xs text-faint">
        Everyone fills at the round&apos;s clearing price, never worse than your limit.
      </p>

      <AnimatePresence>
        {isConnected && market && !helperReady && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="mt-3 text-center text-xs text-muted"
          >
            Auto-reveal is off, so your wallet will ask you to confirm each reveal.{" "}
            <button className="font-medium text-seal hover:underline" onClick={onEnableHelper}>
              Turn it on
            </button>
          </motion.p>
        )}
      </AnimatePresence>
    </section>
  );
}

function Field({
  label,
  unit,
  value,
  onChange,
  right,
}: {
  label: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  right?: React.ReactNode;
}) {
  return (
    <label className="mb-3 block rounded-2xl border border-line bg-panel-2 px-4 py-3 transition focus-within:border-seal/70">
      <div className="mb-1 flex items-center justify-between text-xs text-muted">
        <span>{label}</span>
        {right}
      </div>
      <div className="flex items-baseline gap-2">
        <input
          inputMode="decimal"
          placeholder="0.0"
          value={value}
          onChange={(e) => {
            const v = e.target.value.replace(",", ".");
            if (v === "" || /^\d*\.?\d*$/.test(v)) onChange(v);
          }}
          className="num w-full bg-transparent text-2xl outline-none placeholder:text-faint"
        />
        <span className="shrink-0 text-sm font-medium text-muted">{unit}</span>
      </div>
    </label>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted">{k}</span>
      <span className="num text-right">{v}</span>
    </div>
  );
}
