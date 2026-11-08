#!/usr/bin/env bash
# One-command local devnet: anvil + contracts + web env + keeper.
#   npm run local          (Ctrl-C stops everything)
# Uses anvil's public, well-known dev keys. Never use them on a real network.
set -euo pipefail
cd "$(dirname "$0")/.."

DEPLOYER_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80   # anvil #0
KEEPER_KEY=0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6     # anvil #9
RPC=http://127.0.0.1:8545

if ! curl -s -o /dev/null -X POST -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' "$RPC"; then
  echo "starting anvil (1s blocks)…"
  anvil --silent --block-time 1 &
  ANVIL_PID=$!
  trap 'kill $ANVIL_PID 2>/dev/null' EXIT
  sleep 2
fi

echo "deploying…"
(cd contracts && EXPECTED_CHAIN_ID=31337 forge script script/Deploy.s.sol --rpc-url "$RPC" \
  --broadcast --private-key "$DEPLOYER_KEY" >/dev/null)
AUCTION=$(node -e 'console.log(require("./contracts/deployments/31337.json").auction)')
node contracts/export-abis.mjs >/dev/null

cat > apps/web/.env.local <<ENV
NEXT_PUBLIC_CHAIN_ID=31337
NEXT_PUBLIC_AUCTION_ADDRESS=$AUCTION
NEXT_PUBLIC_RPC_URL=$RPC
ENV
echo "auction $AUCTION (apps/web/.env.local written)"
echo "now run 'npm run dev' in another terminal and open http://localhost:3000"
echo "import anvil key #1 or #2 into your wallet and add network $RPC (chain 31337)"

ELYSIUM_RPC_URL=$RPC EXPECTED_CHAIN_ID=31337 AUCTION_ADDRESS=$AUCTION KEEPER_PRIVATE_KEY=$KEEPER_KEY \
  npm run start -w @lethe/keeper
