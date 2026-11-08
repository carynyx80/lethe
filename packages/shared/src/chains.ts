import { defineChain } from "viem";
import { foundry } from "viem/chains";

/**
 * Elysium testnet, from https://elysium.kinetiq.xyz/docs/connecting-to-elysium
 * (research snapshot 8 Nov 2026; see docs/network-evidence.md). Recheck before relying on it.
 */
export const elysiumTestnet = defineChain({
  id: 99801,
  name: "Elysium Testnet",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.elysium.kinetiq.xyz"] } },
  blockExplorers: {
    default: { name: "Elysium Explorer", url: "https://elysium.kinetiq.xyz/testnet-explorer" },
  },
  testnet: true,
});

/** Elysium mainnet: chain ID documented, endpoints not yet published. Writes stay disabled. */
export const ELYSIUM_MAINNET_ID = 99901;

export const localChain = defineChain({ ...foundry, name: "Local devnet" });

export const supportedChains = [elysiumTestnet, localChain] as const;

export function chainById(id: number) {
  const chain = supportedChains.find((c) => c.id === id);
  if (!chain) throw new Error(`Unsupported chain ${id}. Lethe runs on Elysium testnet (99801) or local (31337).`);
  return chain;
}
