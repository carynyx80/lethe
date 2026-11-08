"use client";

import { useEffect, useRef } from "react";
import { useAccount } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import { parseEventLogs, type Address } from "viem";
import { letheAuctionAbi } from "@lethe/shared";
import { activeChain, wagmiConfig } from "./wagmi";
import { orderKey, useOrderStore, type LocalOrder } from "./orders";
import { friendlyError, revertName, sendWithHelper, sendWithWallet } from "./tx";
import type { Clock, Market } from "./market";
import type { useHelper } from "./helper";

const SETTLE_GRACE_S = 4; // give the keeper a head start before this browser settles
const REVEAL_DELAY_S = 0.4; // wait until the chain has certainly entered the reveal phase

/**
 * Runs in the background while the app is open:
 *  - reveals this browser's sealed orders as soon as their reveal phase opens (helper key first,
 *    wallet pop-up as a fallback), so traders never have to come back and click "reveal";
 *  - settles rounds holding our orders if the keeper hasn't within a few seconds;
 *  - marks orders whose reveal window passed.
 */
export function useOrderEngine(market: Market | undefined, clock: Clock | undefined, helper: ReturnType<typeof useHelper>) {
  const { address } = useAccount();
  const inflight = useRef(new Set<string>());
  const attempts = useRef(new Map<string, number>());
  const lastSettleTry = useRef(new Map<string, number>());
  const latest = useRef({ clock, helper, address });
  latest.current = { clock, helper, address };

  // Recover orders interrupted by a reload: in-flight reveals go back to "sealed" (retried), and
  // commits whose receipt we never saw are resolved from their transaction hash.
  useEffect(() => {
    if (!market) return;
    const store = useOrderStore.getState();
    for (const o of store.orders) {
      if (o.state === "revealing") store.update(o.key, { state: "sealed" });
      if (o.state === "sealing" && o.commitTx) void recoverCommit(o, market.auction);
    }
  }, [market]);

  useEffect(() => {
    if (!market) return;
    const tick = async () => {
      const { clock, helper, address } = latest.current;
      if (!clock) return;
      const store = useOrderStore.getState();
      const mine = store.orders.filter(
        (o) => o.chainId === activeChain.id && o.auction.toLowerCase() === market.auction.toLowerCase(),
      );
      const len = market.commitSeconds + market.revealSeconds;
      const startOf = (r: bigint) => market.genesis + Number(r) * len;

      for (const o of mine) {
        const r = BigInt(o.round);
        const revealAt = startOf(r) + market.commitSeconds;
        const end = startOf(r) + len;

        if (o.state === "sealed" && clock.now >= end) {
          store.update(o.key, { state: "failed", note: "Reveal window passed. The bond is forfeited." });
          continue;
        }
        if (o.state === "sealed" && o.index !== undefined && clock.now >= revealAt + REVEAL_DELAY_S) {
          void reveal(o, helper, address);
        }
      }

      // settle fallback for rounds we care about
      const rounds = new Set(
        mine.filter((o) => o.state === "revealed" || o.state === "failed").map((o) => o.round),
      );
      for (const rs of rounds) {
        const r = BigInt(rs);
        if (clock.now < startOf(r) + len + SETTLE_GRACE_S) continue;
        const k = `settle:${rs}`;
        const last = lastSettleTry.current.get(k) ?? 0;
        if (Date.now() - last < 6_000 || inflight.current.has(k)) continue;
        lastSettleTry.current.set(k, Date.now());
        void settleIfNeeded(r, k, helper);
      }
    };

    const reveal = async (o: LocalOrder, helper: ReturnType<typeof useHelper>, address?: Address) => {
      if (inflight.current.has(o.key) || o.index === undefined) return;
      const n = attempts.current.get(o.key) ?? 0;
      if (n >= 4) return;
      const viaHelper = helper.ready && helper.client;
      const viaWallet = !viaHelper && address && address.toLowerCase() === o.trader.toLowerCase();
      if (!viaHelper && !viaWallet) return;
      inflight.current.add(o.key);
      attempts.current.set(o.key, n + 1);
      const store = useOrderStore.getState();
      store.update(o.key, { state: "revealing", note: undefined });
      const call = {
        address: market.auction,
        abi: letheAuctionAbi,
        functionName: "reveal",
        args: [BigInt(o.round), BigInt(o.index), o.isBuy, BigInt(o.price), BigInt(o.amount), o.salt],
      } as const;
      try {
        const receipt = viaHelper ? await sendWithHelper(helper.client!, call) : await sendWithWallet(call);
        store.update(o.key, { state: "revealed", revealTx: receipt.transactionHash });
      } catch (err) {
        const name = revertName(err);
        if (name === "BadStatus") store.update(o.key, { state: "revealed" });
        else if (name === "InsufficientBalance")
          store.update(o.key, {
            state: "failed",
            note: "Not enough funds in your Lethe account to back this order when it was revealed.",
          });
        else store.update(o.key, { state: "sealed", note: friendlyError(err) }); // retried on next tick
      } finally {
        inflight.current.delete(o.key);
      }
    };

    const settleIfNeeded = async (round: bigint, k: string, helper: ReturnType<typeof useHelper>) => {
      if (!helper.ready || !helper.client) return;
      const pub = getPublicClient(wagmiConfig);
      if (!pub) return;
      inflight.current.add(k);
      try {
        const [settled] = await pub.readContract({
          address: market.auction,
          abi: letheAuctionAbi,
          functionName: "results",
          args: [round],
        });
        if (settled) return;
        await sendWithHelper(helper.client, {
          address: market.auction,
          abi: letheAuctionAbi,
          functionName: "settle",
          args: [round],
        });
      } catch {
        // someone else settled first, or a transient RPC error; the next tick retries
      } finally {
        inflight.current.delete(k);
      }
    };

    const id = setInterval(tick, 400);
    return () => clearInterval(id);
  }, [market]);
}

async function recoverCommit(o: LocalOrder, auction: Address) {
  const pub = getPublicClient(wagmiConfig);
  const store = useOrderStore.getState();
  if (!pub || !o.commitTx) return;
  try {
    const receipt = await pub.waitForTransactionReceipt({ hash: o.commitTx, timeout: 30_000 });
    const placed = parseCommitted(receipt.logs, auction);
    if (receipt.status === "success" && placed) {
      store.replaceKey(o.key, { ...o, ...placed, commitBlock: receipt.blockNumber.toString(), state: "sealed" });
    } else {
      store.update(o.key, { state: "failed", note: "The order was not sealed." });
    }
  } catch {
    store.update(o.key, { state: "failed", note: "Couldn't confirm the sealing transaction." });
  }
}

/** Find our Committed event in a receipt and return the order's round, index and key. */
export function parseCommitted(logs: readonly { address: Address; data: `0x${string}`; topics: readonly `0x${string}`[] }[], auction: Address) {
  const events = parseEventLogs({ abi: letheAuctionAbi, eventName: "Committed", logs: logs as never });
  const ev = events.find((e) => e.address.toLowerCase() === auction.toLowerCase());
  if (!ev) return undefined;
  return {
    round: ev.args.round.toString(),
    index: Number(ev.args.index),
    key: orderKey(activeChain.id, auction, ev.args.round, Number(ev.args.index)),
  };
}
