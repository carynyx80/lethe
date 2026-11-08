"use client";

import { erc20Abi, type Address } from "viem";
import { useReadContracts } from "wagmi";
import { letheAuctionAbi } from "@lethe/shared";
import type { Market } from "./market";

export type Balances = {
  walletBase: bigint;
  walletQuote: bigint;
  vaultBase: bigint;
  vaultQuote: bigint;
};

/** Wallet and in-Lethe (free) balances for both tokens, refreshed every couple of seconds. */
export function useBalances(market?: Market, owner?: Address) {
  const enabled = !!market && !!owner;
  const q = useReadContracts({
    contracts:
      market && owner
        ? [
            { address: market.base.address, abi: erc20Abi, functionName: "balanceOf", args: [owner] },
            { address: market.quote.address, abi: erc20Abi, functionName: "balanceOf", args: [owner] },
            { address: market.auction, abi: letheAuctionAbi, functionName: "balanceOf", args: [owner, market.base.address] },
            { address: market.auction, abi: letheAuctionAbi, functionName: "balanceOf", args: [owner, market.quote.address] },
          ]
        : [],
    allowFailure: false,
    query: { enabled, refetchInterval: 2_000 },
  });
  const d = q.data as unknown as [bigint, bigint, bigint, bigint] | undefined;
  const balances: Balances | undefined = d
    ? { walletBase: d[0], walletQuote: d[1], vaultBase: d[2], vaultQuote: d[3] }
    : undefined;
  return { balances, refetch: q.refetch, isLoading: q.isLoading };
}
