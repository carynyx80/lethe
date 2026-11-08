import { createConfig, http } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { elysiumTestnet, localChain } from "@lethe/shared";
import { appConfig } from "./config";

const chain = appConfig.chain ?? elysiumTestnet;

export const wagmiConfig = createConfig({
  chains: [chain],
  // EIP-6963 discovery lists every installed browser wallet (MetaMask, Rabby, OKX, ...) on its own.
  connectors: [
    injected(),
    ...(appConfig.walletConnectProjectId
      ? [
          walletConnect({
            projectId: appConfig.walletConnectProjectId,
            metadata: {
              name: "Lethe",
              description: "Sealed-order batch auctions on Elysium",
              url: typeof window !== "undefined" ? window.location.origin : "",
              icons: [],
            },
            showQrModal: true,
          }),
        ]
      : []),
  ],
  transports: { [chain.id]: http(appConfig.rpcUrl, { batch: true, retryCount: 2 }) } as unknown as Record<
    (typeof chain)["id"],
    ReturnType<typeof http>
  >,
  ssr: true,
  // 100 ms blocks on Elysium: poll often enough for a live feel without hammering the RPC
  pollingInterval: chain.id === localChain.id ? 1_000 : 1_500,
});

export const activeChain = chain;

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
