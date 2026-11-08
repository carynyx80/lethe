/**
 * Lethe keeper: settles every finished round that has orders.
 *
 * settle() is permissionless and idempotent per round, so the keeper holds no special power:
 * if it stops, browsers settle their own rounds (see apps/web/lib/engine.ts) and anyone can call it.
 * Its key only pays gas. Fails closed on a wrong chain or a missing contract.
 */
import { createPublicClient, createWalletClient, http, isAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainById, letheAuctionAbi, Phase } from "@lethe/shared";

function env(name: string, required = true): string {
  const v = process.env[name]?.trim();
  if (!v && required) {
    console.error(`[keeper] missing ${name}. See services/keeper/.env.example`);
    process.exit(1);
  }
  return v ?? "";
}

const rpc = env("ELYSIUM_RPC_URL");
const expected = Number(env("EXPECTED_CHAIN_ID"));
const auctionRaw = env("AUCTION_ADDRESS");
const pk = env("KEEPER_PRIVATE_KEY") as Hex;
const backfill = BigInt(process.env.BACKFILL_ROUNDS || "200");
if (!isAddress(auctionRaw)) throw new Error("AUCTION_ADDRESS is not an address");
const auction = auctionRaw as Address;

const chain = chainById(expected);
const account = privateKeyToAccount(pk);
const pub = createPublicClient({ chain, transport: http(rpc, { retryCount: 3 }) });
const wallet = createWalletClient({ chain, account, transport: http(rpc, { retryCount: 3 }) });

const log = (...a: unknown[]) => console.log(new Date().toISOString(), "[keeper]", ...a);

async function preflight() {
  const id = await pub.getChainId();
  if (id !== expected) throw new Error(`RPC chain id ${id} != EXPECTED_CHAIN_ID ${expected}; refusing to run`);
  const code = await pub.getCode({ address: auction });
  if (!code || code === "0x") throw new Error(`no contract code at ${auction} on chain ${id}`);
  const bal = await pub.getBalance({ address: account.address });
  log(`chain ${id}, auction ${auction}, keeper ${account.address}, gas balance ${bal} wei`);
}

const settledOrEmpty = new Set<bigint>();
let floor = 0n; // every round below this is known settled or empty

async function settleRound(round: bigint) {
  const [count, phase] = await Promise.all([
    pub.readContract({ address: auction, abi: letheAuctionAbi, functionName: "orderCount", args: [round] }),
    pub.readContract({ address: auction, abi: letheAuctionAbi, functionName: "phase", args: [round] }),
  ]);
  if (count === 0n || phase === Phase.Settled) {
    settledOrEmpty.add(round);
    return;
  }
  if (phase !== Phase.Settleable) return;
  try {
    const { request } = await pub.simulateContract({
      address: auction,
      abi: letheAuctionAbi,
      functionName: "settle",
      args: [round],
      account,
    });
    const hash = await wallet.writeContract(request);
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (receipt.status === "success") {
      const [, price, volume] = await pub.readContract({
        address: auction,
        abi: letheAuctionAbi,
        functionName: "results",
        args: [round],
      });
      log(`settled round ${round}: ${count} orders, price ${price}, volume ${volume}, gas ${receipt.gasUsed}, tx ${hash}`);
      settledOrEmpty.add(round);
    } else {
      log(`settle ${round} reverted in tx ${hash}`);
    }
  } catch (err) {
    // usually someone else settled first; the next pass re-reads the phase
    log(`settle ${round} skipped: ${(err as Error).message.split("\n")[0]}`);
  }
}

async function pass() {
  const current = await pub.readContract({ address: auction, abi: letheAuctionAbi, functionName: "currentRound" });
  if (floor === 0n) floor = current > backfill ? current - backfill : 0n;
  for (let r = floor; r < current; r++) {
    if (settledOrEmpty.has(r)) continue;
    await settleRound(r);
  }
  while (settledOrEmpty.has(floor) && floor < current) {
    settledOrEmpty.delete(floor);
    floor++;
  }
}

let stopping = false;
process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));

await preflight();
let lowGasWarned = 0;
while (!stopping) {
  try {
    await pass();
    if (Date.now() - lowGasWarned > 10 * 60_000) {
      const bal = await pub.getBalance({ address: account.address });
      if (bal < 5_000_000_000_000_000n) {
        log(`WARNING low keeper gas balance: ${bal} wei`);
        lowGasWarned = Date.now();
      }
    }
  } catch (err) {
    log(`pass failed: ${(err as Error).message.split("\n")[0]}`);
  }
  await new Promise((r) => setTimeout(r, 1_000));
}
log("stopped");
