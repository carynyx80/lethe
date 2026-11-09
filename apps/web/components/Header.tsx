"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useAccount, useBlockNumber, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { activeChain } from "@/lib/wagmi";
import { friendlyError } from "@/lib/tx";
import { toast } from "@/lib/toast";
import clsx from "clsx";
import { appConfig } from "@/lib/config";

export function Header() {
  return (
    <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
      <a href="/" className="flex items-center gap-2.5" aria-label="Lethe home">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="" width={30} height={30} />
        <span className="text-lg font-semibold tracking-tight">Lethe</span>
        <span className="hidden rounded-full border border-line px-2 py-0.5 text-[11px] font-medium text-muted sm:inline">
          {appConfig.prelaunch ? "mainnet coming" : "testnet"}
        </span>
      </a>
      <div className="flex items-center gap-2">
        <NetworkPill />
        <WalletButton />
      </div>
    </header>
  );
}

function NetworkPill() {
  const { data: block, isError } = useBlockNumber({ watch: true });
  const live = block !== undefined && !isError;
  return (
    <div
      className="hidden items-center gap-2 rounded-full border border-line bg-panel px-3 py-1.5 text-xs text-muted md:flex"
      title={live ? `Latest block ${block}` : "Can't reach the network"}
    >
      <span className={clsx("h-1.5 w-1.5 rounded-full", live ? "bg-reveal shadow-[0_0_8px] shadow-reveal" : "bg-sell")} />
      {activeChain.name}
      {live && <span className="num text-faint">#{block.toString()}</span>}
    </div>
  );
}

export function WalletButton({ big }: { big?: boolean }) {
  const { address, chainId, isConnected } = useAccount();
  const { connectors, connectAsync, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);

  const base = clsx(
    "rounded-full font-medium transition active:scale-[0.98] disabled:opacity-60",
    big ? "w-full py-3.5 text-[15px]" : "px-4 py-2 text-sm",
  );

  if (isConnected && chainId !== activeChain.id) {
    return (
      <button
        className={clsx(base, "bg-warn text-ink hover:brightness-110")}
        disabled={switching}
        onClick={async () => {
          try {
            await switchChainAsync({ chainId: activeChain.id });
          } catch (e) {
            toast.push({ tone: "error", title: "Couldn't switch network", body: friendlyError(e) });
          }
        }}
      >
        {switching ? "Check your wallet…" : `Switch to ${activeChain.name}`}
      </button>
    );
  }

  if (isConnected && address) {
    if (big) return null;
    return (
      <div className="relative">
        <button
          className={clsx(base, "flex items-center gap-2 border border-line bg-panel hover:border-line-2")}
          onClick={() => setMenu((m) => !m)}
        >
          <Avatar address={address} />
          <span className="num">{address.slice(0, 6)}…{address.slice(-4)}</span>
        </button>
        <Popover open={menu} onClose={() => setMenu(false)}>
          <button
            className="w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-panel-2"
            onClick={() => {
              void navigator.clipboard.writeText(address);
              toast.push({ tone: "success", title: "Address copied" });
              setMenu(false);
            }}
          >
            Copy address
          </button>
          <button
            className="w-full rounded-xl px-3 py-2 text-left text-sm text-sell hover:bg-panel-2"
            onClick={() => {
              disconnect();
              setMenu(false);
            }}
          >
            Disconnect
          </button>
        </Popover>
      </div>
    );
  }

  // EIP-6963 gives each installed wallet its own connector; the generic "Injected" one is a fallback.
  const named = connectors.filter((c) => c.id !== "injected");
  const list = named.length > 0 ? named : connectors;

  return (
    <>
      <button className={clsx(base, "bg-fg text-ink hover:bg-white")} onClick={() => setOpen(true)} disabled={isPending}>
        {isPending ? "Connecting…" : "Connect wallet"}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          >
            <motion.div
              className="card w-full max-w-sm p-5"
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 24, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-label="Connect a wallet"
            >
              <div className="mb-1 text-base font-semibold">Connect a wallet</div>
              <p className="mb-4 text-sm text-muted">
                Lethe never holds your keys. You approve every order in your own wallet.
              </p>
              <div className="space-y-2">
                {list.map((c) => (
                  <button
                    key={c.uid}
                    className="flex w-full items-center gap-3 rounded-2xl border border-line bg-panel-2 px-4 py-3 text-left text-sm font-medium transition hover:border-seal/60"
                    onClick={async () => {
                      try {
                        await connectAsync({ connector: c, chainId: activeChain.id });
                        setOpen(false);
                      } catch (e) {
                        toast.push({ tone: "error", title: "Couldn't connect", body: friendlyError(e) });
                      }
                    }}
                  >
                    {c.icon ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.icon} alt="" className="h-7 w-7 rounded-lg" />
                    ) : (
                      <span className="grid h-7 w-7 place-items-center rounded-lg bg-line text-xs">◎</span>
                    )}
                    {c.name === "Injected" ? "Browser wallet" : c.name}
                  </button>
                ))}
              </div>
              {list.length === 0 && (
                <p className="text-sm text-muted">
                  No wallet found. Install MetaMask or Rabby, then refresh this page.
                </p>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function Popover({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose();
    const t = setTimeout(() => document.addEventListener("click", h), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("click", h);
    };
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          className="card absolute right-0 z-40 mt-2 w-48 p-1.5"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Avatar({ address }: { address: string }) {
  const h = parseInt(address.slice(2, 8), 16) % 360;
  return (
    <span
      className="inline-block h-5 w-5 rounded-full"
      style={{ background: `conic-gradient(from ${h}deg, hsl(${h} 80% 70%), hsl(${(h + 120) % 360} 70% 60%), hsl(${h} 80% 70%))` }}
    />
  );
}
