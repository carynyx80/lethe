# Elysium network evidence

Source: "Building on Elysium with Claude Code" research report supplied by the project owner, snapshot
**8 November 2026 (WAT)**. It cites the official docs below. The build environment that wrote this code could not
reach `*.kinetiq.xyz`, so **none of these values were fetched or probed directly**. Recheck them before any testnet
broadcast.

| Parameter | Value | Status |
| --- | --- | --- |
| Operator | Kinetiq (@Enter_Elysium) | documented |
| Stack | Arbitrum Orbit (Nitro / stock ArbOS), Conduit, AnyTrust DA, settles to HyperEVM | documented |
| Testnet chain ID | 99801 | documented, used in `packages/shared/src/chains.ts` |
| Testnet RPC | https://testnet-rpc.elysium.kinetiq.xyz | documented, not probed |
| Testnet explorer | https://elysium.kinetiq.xyz/testnet-explorer | documented; `/tx/<hash>` path assumed |
| Mainnet chain ID | 99901 | documented, pre-launch; disabled in code |
| Mainnet RPC / explorer | unpublished at snapshot | unresolved |
| Native gas | HYPE (bridged 1:1 from HyperEVM) | documented |
| Blocks | 100 ms canonical, ~300 ms perceived receipts | documented target, not measured |
| Faucet URL | not resolved | unresolved; follow the official site |
| HyperCore reads/writes | planned ~4 weeks after mainnet | not used by Lethe |

Lethe deploys its own valueless `tHYPE` / `tUSDC` test tokens on testnet and does not depend on any third-party
contract address.

Official sources:

- https://elysium.kinetiq.xyz/docs/what-is-elysium
- https://elysium.kinetiq.xyz/docs/connecting-to-elysium
- https://elysium.kinetiq.xyz/docs/building-on-elysium
- https://elysium.kinetiq.xyz/docs/security-and-data-availability
- https://elysium.kinetiq.xyz/docs/token-bridging-on-elysium
- https://kinetiq.xyz/blog/elysium-mainnet-launch
