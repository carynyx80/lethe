"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Address, Hex } from "viem";

/**
 * Sealed-order secrets live only in this browser. Without them an order cannot be revealed, so
 * they are persisted in localStorage and never sent anywhere. Bigints are stored as strings.
 */
export type OrderState =
  | "sealing" // commit tx sent, waiting for inclusion
  | "sealed" // committed on-chain, waiting for reveal phase
  | "revealing" // reveal tx in flight
  | "revealed" // revealed, waiting for settlement
  | "cancelled"
  | "failed"; // could not be revealed (e.g. missed window or not enough funds)

export type LocalOrder = {
  key: string; // chainId:auction:round:index (or :pending:salt before inclusion)
  chainId: number;
  auction: Address;
  trader: Address;
  round: string;
  index?: number;
  isBuy: boolean;
  price: string;
  amount: string;
  salt: Hex;
  commitTx?: Hex;
  commitBlock?: string; // lower bound for log queries
  revealTx?: Hex;
  createdAt: number;
  state: OrderState;
  note?: string;
};

type Store = {
  orders: LocalOrder[];
  add: (o: LocalOrder) => void;
  update: (key: string, patch: Partial<LocalOrder>) => void;
  replaceKey: (oldKey: string, o: LocalOrder) => void;
  remove: (key: string) => void;
};

export const useOrderStore = create<Store>()(
  persist(
    (set) => ({
      orders: [],
      add: (o) => set((s) => ({ orders: [o, ...s.orders].slice(0, 200) })),
      update: (key, patch) => set((s) => ({ orders: s.orders.map((o) => (o.key === key ? { ...o, ...patch } : o)) })),
      replaceKey: (oldKey, o) => set((s) => ({ orders: s.orders.map((x) => (x.key === oldKey ? o : x)) })),
      remove: (key) => set((s) => ({ orders: s.orders.filter((o) => o.key !== key) })),
    }),
    { name: "lethe:orders:v1", storage: createJSONStorage(() => localStorage) },
  ),
);

export function orderKey(chainId: number, auction: Address, round: bigint, index: number) {
  return `${chainId}:${auction.toLowerCase()}:${round}:${index}`;
}

export function randomSalt(): Hex {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
}
