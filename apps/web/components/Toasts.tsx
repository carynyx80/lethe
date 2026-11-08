"use client";

import { AnimatePresence, motion } from "framer-motion";
import clsx from "clsx";
import { useToasts } from "@/lib/toast";

export function Toasts() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            role="status"
            className="card pointer-events-auto w-full max-w-sm p-3.5 shadow-2xl shadow-black/40"
            onClick={() => dismiss(t.id)}
          >
            <div className="flex items-start gap-3">
              <span
                className={clsx(
                  "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                  t.tone === "success" && "bg-buy",
                  t.tone === "error" && "bg-sell",
                  t.tone === "info" && "bg-seal",
                  t.tone === "pending" && "animate-pulse bg-warn",
                )}
              />
              <div>
                <div className="text-sm font-medium">{t.title}</div>
                {t.body && <div className="mt-0.5 text-xs leading-relaxed text-muted">{t.body}</div>}
              </div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
