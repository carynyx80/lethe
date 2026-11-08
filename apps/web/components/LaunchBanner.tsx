import { motion } from "framer-motion";

/** Shown before a market is deployed: an announcement, not an error. */
export function LaunchBanner() {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="card relative mb-6 overflow-hidden p-5 sm:p-6"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-gradient-to-br from-seal/30 to-reveal/20 blur-3xl"
      />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-seal/40 bg-seal/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-seal">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-seal" />
            Mainnet coming
          </div>
          <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
            Lethe is launching on{" "}
            <span className="bg-gradient-to-r from-seal to-reveal bg-clip-text text-transparent">Elysium</span>
          </h2>
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-muted">
            Sealed-order trading for the Hyperliquid ecosystem. Trading opens soon. Until then, this is a preview of
            how it works.
          </p>
        </div>
        <a
          href="https://elysium.kinetiq.xyz/docs/what-is-elysium"
          target="_blank"
          rel="noreferrer"
          className="shrink-0 self-start rounded-full border border-line px-4 py-2 text-sm font-medium text-muted transition hover:border-seal/60 hover:text-fg sm:self-auto"
        >
          About Elysium ↗
        </a>
      </div>
    </motion.section>
  );
}
