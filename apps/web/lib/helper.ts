"use client";

import { useEffect, useMemo, useState } from "react";
import { createWalletClient, http, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { useBalance } from "wagmi";
import { appConfig } from "./config";
import { activeChain } from "./wagmi";

/**
 * The reveal helper is a throwaway key kept in this browser that only pays gas. Reveals are
 * permissionless (the commitment binds the trader and every order field), so this key can reveal
 * and settle your sealed orders without a wallet pop-up but can never move or redirect your funds.
 * The worst a leaked helper key can do is spend the small amount of HYPE you gave it for gas.
 */
const storageKey = () => `lethe:helper:v1:${activeChain.id}`;

function loadOrCreate(): Hex {
  try {
    const existing = localStorage.getItem(storageKey());
    if (existing && /^0x[0-9a-fA-F]{64}$/.test(existing)) return existing as Hex;
    const pk = generatePrivateKey();
    localStorage.setItem(storageKey(), pk);
    return pk;
  } catch {
    // storage blocked (private mode): keep a session-only key
    return generatePrivateKey();
  }
}

/** Gas the helper should hold to be considered ready (covers many reveals at testnet prices). */
export const HELPER_MIN_BALANCE = 2_000_000_000_000_000n; // 0.002 HYPE
export const HELPER_TOP_UP = 10_000_000_000_000_000n; // 0.01 HYPE

export function useHelper() {
  const [pk, setPk] = useState<Hex>();
  useEffect(() => setPk(loadOrCreate()), []);
  const account = useMemo(() => (pk ? privateKeyToAccount(pk) : undefined), [pk]);
  const client = useMemo(
    () =>
      account
        ? createWalletClient({ account, chain: activeChain, transport: http(appConfig.rpcUrl) })
        : undefined,
    [account],
  );
  const balance = useBalance({ address: account?.address, query: { enabled: !!account, refetchInterval: 5_000 } });
  const ready = (balance.data?.value ?? 0n) >= HELPER_MIN_BALANCE;
  return { account, client, balance: balance.data?.value, ready, refetch: balance.refetch };
}
