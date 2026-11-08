"use client";

import { create } from "zustand";

export type Toast = { id: number; tone: "info" | "success" | "error" | "pending"; title: string; body?: string };

type Store = {
  toasts: Toast[];
  push: (t: Omit<Toast, "id">) => number;
  update: (id: number, t: Partial<Toast>) => void;
  dismiss: (id: number) => void;
};

let nextId = 1;

export const useToasts = create<Store>()((set, get) => ({
  toasts: [],
  push: (t) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { ...t, id }].slice(-4) }));
    if (t.tone !== "pending") setTimeout(() => get().dismiss(id), 5_000);
    return id;
  },
  update: (id, t) => {
    set((s) => ({ toasts: s.toasts.map((x) => (x.id === id ? { ...x, ...t } : x)) }));
    if (t.tone && t.tone !== "pending") setTimeout(() => get().dismiss(id), 5_000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

export const toast = {
  push: (t: Omit<Toast, "id">) => useToasts.getState().push(t),
  update: (id: number, t: Partial<Toast>) => useToasts.getState().update(id, t),
};
