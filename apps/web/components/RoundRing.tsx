"use client";

import { motion } from "framer-motion";
import clsx from "clsx";
import { fromPrice, pretty } from "@lethe/shared";
import type { Clock, Market } from "@/lib/market";

type Result = { settled: boolean; price: bigint; volume: bigint; round: bigint };

const R = 92;
const C = 2 * Math.PI * R;

export function RoundRing({
  market,
  clock,
  orders,
  results,
}: {
  market?: Market;
  clock?: Clock;
  orders?: number;
  results?: Result[];
}) {
  const commitShare = market ? market.commitSeconds / (market.commitSeconds + market.revealSeconds) : 2 / 3;
  const progress = clock?.progress ?? 0;
  const phase = clock?.phase ?? "pending";
  const last = results?.filter((r) => r.settled && r.volume > 0n).at(-1);
  const secs = clock ? Math.max(0, Math.ceil(clock.secondsLeft)) : 0;

  return (
    <section className="card relative overflow-hidden p-5 sm:p-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.14em] text-faint">Round</div>
          <div className="num text-lg">#{clock ? clock.round.toString() : "—"}</div>
        </div>
        <div className="text-right">
          <div className="text-xs font-medium uppercase tracking-[0.14em] text-faint">Sealed orders</div>
          <div className="num text-lg">
            {orders ?? "—"}
            {market && <span className="text-faint">/{market.maxOrders}</span>}
          </div>
        </div>
      </div>

      <div className="relative mx-auto my-2 aspect-square w-full max-w-[260px]">
        <svg viewBox="0 0 220 220" className="h-full w-full -rotate-90">
          <defs>
            <linearGradient id="seal" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#6b5cf0" />
              <stop offset="1" stopColor="#9a8cff" />
            </linearGradient>
          </defs>
          {/* track: commit then reveal */}
          <circle cx="110" cy="110" r={R} fill="none" stroke="#1d2131" strokeWidth="12" />
          <circle
            cx="110"
            cy="110"
            r={R}
            fill="none"
            stroke="url(#seal)"
            strokeOpacity={0.22}
            strokeWidth="12"
            strokeDasharray={`${C * commitShare - 3} ${C}`}
          />
          <circle
            cx="110"
            cy="110"
            r={R}
            fill="none"
            stroke="#3fe0c0"
            strokeOpacity={0.18}
            strokeWidth="12"
            strokeDasharray={`${C * (1 - commitShare) - 3} ${C}`}
            strokeDashoffset={-C * commitShare}
          />
          {/* progress */}
          <circle
            cx="110"
            cy="110"
            r={R}
            fill="none"
            stroke={phase === "reveal" ? "#3fe0c0" : "url(#seal)"}
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={`${Math.max(0.001, C * progress)} ${C}`}
            style={{ transition: "stroke-dasharray 120ms linear" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <motion.div
            key={phase}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className={clsx(
              "mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em]",
              phase === "reveal" ? "text-reveal" : "text-seal",
            )}
          >
            <span className={clsx("h-1.5 w-1.5 rounded-full", phase === "reveal" ? "bg-reveal" : "bg-seal", "animate-pulse")} />
            {phase === "commit" ? "Sealing" : phase === "reveal" ? "Revealing" : "Opens soon"}
          </motion.div>
          <div className="num text-6xl font-light tabular-nums">{clock ? secs : "–"}</div>
          <div className="mt-1 text-xs text-muted">
            {phase === "commit" ? "seconds to seal orders" : phase === "reveal" ? "seconds until clearing" : "seconds"}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 border-t border-line pt-4">
        <Stat
          label="Last clearing price"
          value={last && market ? pretty(last.price, market.quote.decimals + 18 - market.base.decimals, 4) : "—"}
          unit={market ? `${market.quote.symbol}` : ""}
        />
        <Stat
          label="Last volume"
          value={last && market ? pretty(last.volume, market.base.decimals, 3) : "—"}
          unit={market?.base.symbol ?? ""}
        />
      </div>
      <PriceStrip results={results} market={market} />
    </section>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-faint">{label}</div>
      <div className="num mt-0.5 text-base">
        {value} <span className="text-xs text-muted">{value !== "—" ? unit : ""}</span>
      </div>
    </div>
  );
}

/** Clearing price per round: a bar where the round traded, a dot where it didn't. */
function PriceStrip({ results, market }: { results?: Result[]; market?: Market }) {
  if (!results || !market || results.length === 0) return null;
  const traded = results.filter((r) => r.settled && r.volume > 0n);
  const prices = traded.map((r) => Number(fromPrice(r.price, market.base.decimals, market.quote.decimals)));
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  return (
    <div className="mt-4">
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-faint">Recent rounds</div>
      <div className="flex h-12 items-end gap-[3px]" aria-label="Clearing price by round">
        {results.map((r) => {
          const ok = r.settled && r.volume > 0n;
          const p = ok ? Number(fromPrice(r.price, market.base.decimals, market.quote.decimals)) : 0;
          const h = !ok ? 0 : max === min ? 60 : 18 + ((p - min) / span) * 82;
          return (
            <div
              key={r.round.toString()}
              className="flex h-full flex-1 flex-col justify-end"
              title={ok ? `#${r.round}: ${p} ${market.quote.symbol}` : `#${r.round}: no trade`}
            >
              {ok ? (
                <div className="w-full rounded-sm bg-gradient-to-t from-seal-deep to-reveal opacity-80" style={{ height: `${h}%` }} />
              ) : (
                <div className="mx-auto h-1 w-1 rounded-full bg-line-2" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
