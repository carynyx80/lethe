"use client";

import { useState } from "react";
import clsx from "clsx";
import { formatEther, formatUnits, parseUnits } from "viem";
import { useAccount, useBalance } from "wagmi";
import { pretty } from "@lethe/shared";
import type { Market, TokenInfo } from "@/lib/market";
import type { Balances } from "@/lib/balances";
import { claimFaucet, deposit, fundHelper, withdraw } from "@/lib/actions";
import { HELPER_TOP_UP } from "@/lib/helper";
import { friendlyError } from "@/lib/tx";
import { toast } from "@/lib/toast";
import { activeChain } from "@/lib/wagmi";

type Helper = { account?: { address: `0x${string}` }; balance?: bigint; ready: boolean; refetch: () => void };

export function AccountPanel({
  market,
  balances,
  helper,
  refresh,
}: {
  market?: Market;
  balances?: Balances;
  helper: Helper;
  refresh: () => void;
}) {
  const { address, isConnected, chainId } = useAccount();
  const gas = useBalance({ address, query: { enabled: !!address, refetchInterval: 5_000 } });
  const [busy, setBusy] = useState<string>();

  if (!isConnected || chainId !== activeChain.id || !market || !address) {
    return (
      <section className="card p-5 sm:p-6">
        <h2 className="mb-1 text-base font-semibold">Your account</h2>
        <p className="text-sm text-muted">Connect a wallet on {activeChain.name} to see balances.</p>
      </section>
    );
  }

  const wrap = async (label: string, fn: () => Promise<void>, ok: string) => {
    setBusy(label);
    try {
      await fn();
      toast.push({ tone: "success", title: ok });
      refresh();
      helper.refetch();
      void gas.refetch();
    } catch (e) {
      toast.push({ tone: "error", title: "That didn't go through", body: friendlyError(e) });
    } finally {
      setBusy(undefined);
    }
  };

  const lowGas = gas.data && gas.data.value < 1_000_000_000_000_000n;

  return (
    <section className="card p-5 sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold">Your account</h2>
        <button
          disabled={!!busy}
          onClick={() =>
            wrap(
              "faucet",
              async () => {
                await claimFaucet(market.quote);
                await claimFaucet(market.base);
              },
              "Test tokens received",
            )
          }
          className="rounded-full border border-line px-3 py-1 text-xs font-medium text-muted transition hover:border-seal/60 hover:text-fg disabled:opacity-50"
        >
          {busy === "faucet" ? "Claiming…" : "Get test tokens"}
        </button>
      </div>

      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 gap-y-1 text-sm">
        <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-faint">Token</span>
        <span className="text-right text-[11px] font-medium uppercase tracking-[0.12em] text-faint">Wallet</span>
        <span className="text-right text-[11px] font-medium uppercase tracking-[0.12em] text-faint">In Lethe</span>
        {[
          { t: market.quote, w: balances?.walletQuote, v: balances?.vaultQuote },
          { t: market.base, w: balances?.walletBase, v: balances?.vaultBase },
        ].map(({ t, w, v }) => (
          <TokenRow
            key={t.address}
            token={t}
            wallet={w}
            vault={v}
            busy={busy}
            onDeposit={(amt) => wrap(`dep-${t.symbol}`, () => deposit(market, t, address, amt), `${t.symbol} deposited`)}
            onWithdraw={(amt) => wrap(`wd-${t.symbol}`, () => withdraw(market, t, amt), `${t.symbol} withdrawn to your wallet`)}
          />
        ))}
      </div>

      <div className="mt-4 rounded-2xl border border-line bg-panel-2/60 p-3.5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className={clsx("h-1.5 w-1.5 rounded-full", helper.ready ? "bg-reveal" : "bg-faint")} />
              Auto-reveal {helper.ready ? "on" : "off"}
            </div>
            <p className="mt-0.5 text-xs text-muted">
              {helper.ready
                ? `A gas-only helper in this browser reveals your orders on time. Gas left: ${Number(formatEther(helper.balance ?? 0n)).toFixed(4)} HYPE.`
                : "Give a gas-only helper in this browser a little HYPE so it can reveal your orders. It can never touch your funds."}
            </p>
          </div>
          <button
            disabled={!!busy || !helper.account}
            onClick={() =>
              wrap("helper", () => fundHelper(helper.account!.address, HELPER_TOP_UP), "Auto-reveal topped up")
            }
            className="shrink-0 rounded-full bg-seal/15 px-3 py-1.5 text-xs font-semibold text-seal transition hover:bg-seal/25 disabled:opacity-50"
          >
            {busy === "helper" ? "Sending…" : helper.ready ? "Top up" : `Turn on · ${formatEther(HELPER_TOP_UP)} HYPE`}
          </button>
        </div>
      </div>

      {lowGas && (
        <p className="mt-3 text-xs text-warn">
          Your wallet is low on HYPE for gas. Get testnet HYPE from the Elysium faucet or bridge it from HyperEVM testnet.
        </p>
      )}
    </section>
  );
}

function TokenRow({
  token,
  wallet,
  vault,
  busy,
  onDeposit,
  onWithdraw,
}: {
  token: TokenInfo;
  wallet?: bigint;
  vault?: bigint;
  busy?: string;
  onDeposit: (amt: bigint) => void;
  onWithdraw: (amt: bigint) => void;
}) {
  const [mode, setMode] = useState<"deposit" | "withdraw">();
  const [val, setVal] = useState("");
  const max = mode === "deposit" ? wallet : vault;
  let amt: bigint | undefined;
  try {
    amt = val ? parseUnits(val, token.decimals) : undefined;
  } catch {
    amt = undefined;
  }
  const valid = amt !== undefined && amt > 0n && max !== undefined && amt <= max;
  const isBusy = busy === `dep-${token.symbol}` || busy === `wd-${token.symbol}`;

  return (
    <>
      <span className="font-medium">{token.symbol}</span>
      <span className="num text-right text-muted">{wallet !== undefined ? pretty(wallet, token.decimals, 2) : "—"}</span>
      <span className="num text-right">{vault !== undefined ? pretty(vault, token.decimals, 4) : "—"}</span>
      <div className="col-span-3 -mt-0.5 mb-2 flex gap-3 text-xs">
        <button className="font-medium text-seal hover:underline" onClick={() => setMode(mode === "deposit" ? undefined : "deposit")}>
          Deposit
        </button>
        <button className="font-medium text-muted hover:text-fg hover:underline" onClick={() => setMode(mode === "withdraw" ? undefined : "withdraw")}>
          Withdraw
        </button>
      </div>
      {mode && (
        <div className="col-span-3 mb-3 flex items-center gap-2">
          <div className="flex flex-1 items-center rounded-full border border-line bg-panel-2 px-3 py-1.5 focus-within:border-seal/70">
            <input
              autoFocus
              inputMode="decimal"
              placeholder={`0.0 ${token.symbol}`}
              value={val}
              onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && setVal(e.target.value)}
              className="num w-full bg-transparent text-sm outline-none placeholder:text-faint"
            />
            <button
              className="text-[11px] font-medium text-seal"
              onClick={() => max !== undefined && setVal(trim(max, token.decimals))}
            >
              Max
            </button>
          </div>
          <button
            disabled={!valid || !!busy}
            onClick={() => {
              if (!amt) return;
              if (mode === "deposit") onDeposit(amt);
              else onWithdraw(amt);
              setVal("");
              setMode(undefined);
            }}
            className="rounded-full bg-fg px-4 py-1.5 text-xs font-semibold text-ink disabled:opacity-40"
          >
            {isBusy ? "…" : mode === "deposit" ? "Deposit" : "Withdraw"}
          </button>
        </div>
      )}
    </>
  );
}

function trim(v: bigint, decimals: number) {
  return formatUnits(v, decimals);
}
