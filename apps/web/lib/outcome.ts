"use client";

import { useQuery } from "@tanstack/react-query";
import { getPublicClient } from "wagmi/actions";
import { letheAuctionAbi } from "@lethe/shared";
import { wagmiConfig } from "./wagmi";
import type { LocalOrder } from "./orders";
import type { Market } from "./market";

export type Outcome =
  | { kind: "pending" }
  | { kind: "filled"; base: bigint; quote: bigint; price: bigint; partial: boolean }
  | { kind: "unfilled"; clearingPrice: bigint }
  | { kind: "forfeited" };

/** Read what happened to one of our orders once its round is settled. Never guesses: "pending" until proven. */
export function useOutcome(o: LocalOrder, market?: Market) {
  const relevant = o.index !== undefined && (o.state === "revealed" || o.state === "failed");
  return useQuery({
    queryKey: ["outcome", o.key, o.state],
    enabled: !!market && relevant,
    refetchInterval: (q) => (q.state.data && q.state.data.kind !== "pending" ? false : 2_000),
    staleTime: Infinity,
    queryFn: async (): Promise<Outcome> => {
      const pub = getPublicClient(wagmiConfig);
      if (!pub || !market || o.index === undefined) return { kind: "pending" };
      const round = BigInt(o.round);
      const [settled, price] = await pub.readContract({
        address: market.auction,
        abi: letheAuctionAbi,
        functionName: "results",
        args: [round],
      });
      if (!settled) return { kind: "pending" };
      const onchain = await pub.readContract({
        address: market.auction,
        abi: letheAuctionAbi,
        functionName: "getOrder",
        args: [round, BigInt(o.index)],
      });
      if (onchain.status === 1) return { kind: "forfeited" }; // still Committed after settle => bond slashed
      if (onchain.status !== 2) return { kind: "unfilled", clearingPrice: price };
      const latest = await pub.getBlockNumber();
      const from = o.commitBlock ? BigInt(o.commitBlock) : latest > 50_000n ? latest - 50_000n : 0n;
      const logs = await pub.getContractEvents({
        address: market.auction,
        abi: letheAuctionAbi,
        eventName: "Filled",
        args: { round, index: BigInt(o.index) },
        fromBlock: from,
        toBlock: latest,
      });
      const fill = logs[0]?.args;
      if (!fill || !fill.baseFilled) return { kind: "unfilled", clearingPrice: price };
      return {
        kind: "filled",
        base: fill.baseFilled,
        quote: fill.quoteAmount ?? 0n,
        price,
        partial: fill.baseFilled < BigInt(o.amount),
      };
    },
  });
}
