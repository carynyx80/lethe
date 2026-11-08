const steps = [
  {
    n: "1",
    title: "Seal",
    body: "Your order goes on-chain as a fingerprint only. Nobody can see your side, size or price, not even the sequencer.",
    tone: "text-seal",
  },
  {
    n: "2",
    title: "Reveal",
    body: "When sealing closes, orders are opened automatically. It's too late for anyone to react or jump ahead of you.",
    tone: "text-reveal",
  },
  {
    n: "3",
    title: "Clear",
    body: "Everyone who trades gets the same fair price, the one that matches the most volume. Never worse than your limit.",
    tone: "text-fg",
  },
];

export function HowItWorks() {
  return (
    <section className="card p-5 sm:p-6">
      <h2 className="mb-1 text-base font-semibold">No front-running, by design</h2>
      <p className="mb-4 text-sm text-muted">Every round runs in three steps.</p>
      <ol className="space-y-3.5">
        {steps.map((s) => (
          <li key={s.n} className="flex gap-3">
            <span className={`num mt-0.5 text-sm font-semibold ${s.tone}`}>{s.n}</span>
            <div>
              <div className={`text-sm font-semibold ${s.tone}`}>{s.title}</div>
              <p className="text-sm leading-relaxed text-muted">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-4 border-t border-line pt-3 text-xs leading-relaxed text-faint">
        Privacy lasts until the reveal. Settled trades are public on-chain. Testnet tokens have no value.
      </p>
    </section>
  );
}
