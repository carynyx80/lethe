import { isAddress, type Address } from "viem";
import { chainById } from "@lethe/shared";

/**
 * Public, build-time configuration. Missing or malformed values do not crash the page: the UI
 * shows a clear "not configured" state instead and every write stays disabled (fail closed).
 */
const rawChainId = process.env.NEXT_PUBLIC_CHAIN_ID;
const rawAuction = process.env.NEXT_PUBLIC_AUCTION_ADDRESS;

function resolve() {
  const problems: string[] = [];
  const chainId = Number(rawChainId || 0);
  let chain: ReturnType<typeof chainById> | undefined;
  try {
    chain = chainById(chainId);
  } catch {
    problems.push("NEXT_PUBLIC_CHAIN_ID must be 99801 (Elysium testnet) or 31337 (local).");
  }
  const auction = rawAuction && isAddress(rawAuction) ? (rawAuction as Address) : undefined;
  if (!auction) problems.push("NEXT_PUBLIC_AUCTION_ADDRESS is not set to a deployed LetheAuction.");
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || chain?.rpcUrls.default.http[0];
  return {
    /** Chain is fine but no market is deployed yet: show the launch state, not an error. */
    prelaunch: !!chain && !auction && problems.length === 1,
    chain,
    auction,
    rpcUrl,
    walletConnectProjectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || undefined,
    problems,
    ready: problems.length === 0,
  };
}

export const appConfig = resolve();
