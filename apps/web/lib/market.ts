"use client";

import { useEffect, useMemo, useState } from "react";
import { useBlock, useReadContract, useReadContracts } from "wagmi";
import { erc20Abi, type Address } from "viem";
import { letheAuctionAbi } from "@lethe/shared";
import { appConfig } from "./config";

export type TokenInfo = { address: Address; symbol: string; decimals: number };

export type Market = {
  auction: Address;
  base: TokenInfo;
  quote: TokenInfo;
  genesis: number;
  commitSeconds: number;
  revealSeconds: number;
  bond: bigint;
  minBase: bigint;
  maxOrders: number;
  treasury: Address;
};

const auctionContract = appConfig.auction
  ? ({ address: appConfig.auction, abi: letheAuctionAbi } as const)
  : undefined;

/** Immutable market parameters, read once from the contract. */
export function useMarket(): { market?: Market; error?: Error; isLoading: boolean } {
  const params = useReadContracts({
    contracts: auctionContract
      ? [
          { ...auctionContract, functionName: "baseToken" },
          { ...auctionContract, functionName: "quoteToken" },
          { ...auctionContract, functionName: "genesis" },
          { ...auctionContract, functionName: "commitDuration" },
          { ...auctionContract, functionName: "revealDuration" },
          { ...auctionContract, functionName: "bond" },
          { ...auctionContract, functionName: "minBaseAmount" },
          { ...auctionContract, functionName: "maxOrdersPerRound" },
          { ...auctionContract, functionName: "treasury" },
        ]
      : [],
    allowFailure: false,
    query: { enabled: !!auctionContract, staleTime: Infinity },
  });

  const baseAddr = params.data?.[0] as Address | undefined;
  const quoteAddr = params.data?.[1] as Address | undefined;
  const tokens = useReadContracts({
    contracts:
      baseAddr && quoteAddr
        ? [
            { address: baseAddr, abi: erc20Abi, functionName: "symbol" },
            { address: baseAddr, abi: erc20Abi, functionName: "decimals" },
            { address: quoteAddr, abi: erc20Abi, functionName: "symbol" },
            { address: quoteAddr, abi: erc20Abi, functionName: "decimals" },
          ]
        : [],
    allowFailure: false,
    query: { enabled: !!baseAddr && !!quoteAddr, staleTime: Infinity },
  });

  const market = useMemo<Market | undefined>(() => {
    if (!params.data || !tokens.data || !auctionContract || !baseAddr || !quoteAddr) return undefined;
    const p = params.data as unknown as [Address, Address, bigint, bigint, bigint, bigint, bigint, bigint, Address];
    const t = tokens.data as unknown as [string, number, string, number];
    return {
      auction: auctionContract.address,
      base: { address: baseAddr, symbol: t[0], decimals: Number(t[1]) },
      quote: { address: quoteAddr, symbol: t[2], decimals: Number(t[3]) },
      genesis: Number(p[2]),
      commitSeconds: Number(p[3]),
      revealSeconds: Number(p[4]),
      bond: p[5],
      minBase: p[6],
      maxOrders: Number(p[7]),
      treasury: p[8],
    };
  }, [params.data, tokens.data, baseAddr, quoteAddr]);

  return {
    market,
    error: (params.error ?? tokens.error) || undefined,
    isLoading: params.isLoading || tokens.isLoading,
  };
}

export type PhaseName = "pending" | "commit" | "reveal";

export type Clock = {
  now: number; // chain-aligned unix seconds (fractional)
  round: bigint;
  phase: PhaseName;
  roundStart: number;
  revealAt: number;
  roundEnd: number;
  secondsLeft: number; // in the current phase
  progress: number; // 0..1 through the whole round
};

/**
 * A smooth local clock aligned to chain time. Phases are pure functions of block.timestamp, so the
 * UI can count down without polling the contract; the offset is re-anchored on every new block.
 */
export function useClock(market?: Market): Clock | undefined {
  const { data: block } = useBlock({ watch: true, query: { enabled: !!market } });
  const [offset, setOffset] = useState(0);
  const [tick, setTick] = useState(() => Date.now());

  useEffect(() => {
    if (!block) return;
    const local = Date.now() / 1000;
    const chainTs = Number(block.timestamp);
    // block timestamps are whole seconds and blocks may lag; only move the offset forward, or
    // backward when we are clearly ahead of the chain
    setOffset((prev) => {
      const candidate = chainTs - local;
      return candidate > prev || prev - candidate > 2 ? candidate : prev;
    });
  }, [block]);

  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 100);
    return () => clearInterval(id);
  }, []);

  return useMemo(() => {
    if (!market) return undefined;
    const now = tick / 1000 + offset;
    const len = market.commitSeconds + market.revealSeconds;
    if (now < market.genesis) {
      return {
        now,
        round: 0n,
        phase: "pending",
        roundStart: market.genesis,
        revealAt: market.genesis + market.commitSeconds,
        roundEnd: market.genesis + len,
        secondsLeft: market.genesis - now,
        progress: 0,
      };
    }
    const r = Math.floor((now - market.genesis) / len);
    const start = market.genesis + r * len;
    const revealAt = start + market.commitSeconds;
    const end = start + len;
    const phase: PhaseName = now < revealAt ? "commit" : "reveal";
    return {
      now,
      round: BigInt(r),
      phase,
      roundStart: start,
      revealAt,
      roundEnd: end,
      secondsLeft: (phase === "commit" ? revealAt : end) - now,
      progress: (now - start) / len,
    };
  }, [market, tick, offset]);
}

/** Last `count` rounds' results, newest last. */
export function useRecentResults(market: Market | undefined, currentRound: bigint | undefined, count = 24) {
  const from = currentRound !== undefined && currentRound > BigInt(count) ? currentRound - BigInt(count) : 0n;
  const n = currentRound !== undefined ? Number(currentRound - from) : 0;
  return useReadContract({
    address: market?.auction,
    abi: letheAuctionAbi,
    functionName: "resultsRange",
    args: [from, BigInt(n)],
    query: { enabled: !!market && n > 0, refetchInterval: 2_000, select: (rs) => rs.map((r, i) => ({ ...r, round: from + BigInt(i) })) },
  });
}
