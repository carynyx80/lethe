"use client";

import { erc20Abi, parseSignature, type Address } from "viem";
import { getPublicClient, readContract, sendTransaction, signTypedData, waitForTransactionReceipt } from "wagmi/actions";
import { commitmentHash, letheAuctionAbi, testTokenAbi } from "@lethe/shared";
import { activeChain, wagmiConfig } from "./wagmi";
import { orderKey, randomSalt, useOrderStore, type LocalOrder } from "./orders";
import { parseCommitted } from "./engine";
import { sendWithWallet } from "./tx";
import type { Market, TokenInfo } from "./market";

/** Seal an order: hash it locally, commit only the hash, keep the secret in this browser. */
export async function sealOrder(args: {
  market: Market;
  trader: Address;
  round: bigint;
  isBuy: boolean;
  price: bigint;
  amount: bigint;
}): Promise<LocalOrder> {
  const { market, trader, round, isBuy, price, amount } = args;
  const salt = randomSalt();
  const hash = commitmentHash({ chainId: activeChain.id, auction: market.auction, round, trader, isBuy, price, amount, salt });
  const store = useOrderStore.getState();
  const pendingKey = `${activeChain.id}:${market.auction.toLowerCase()}:pending:${salt}`;
  // Persist the secret BEFORE sending, so a crash between signing and inclusion can't lose it.
  const draft: LocalOrder = {
    key: pendingKey,
    chainId: activeChain.id,
    auction: market.auction,
    trader,
    round: round.toString(),
    isBuy,
    price: price.toString(),
    amount: amount.toString(),
    salt,
    createdAt: Date.now(),
    state: "sealing",
  };
  store.add(draft);
  try {
    const receipt = await sendWithWallet({
      address: market.auction,
      abi: letheAuctionAbi,
      functionName: "commit",
      args: [round, hash],
    });
    const placed = parseCommitted(receipt.logs, market.auction);
    if (!placed) throw new Error("Sealed, but the order index wasn't found in the receipt.");
    const done: LocalOrder = {
      ...draft,
      ...placed,
      commitTx: receipt.transactionHash,
      commitBlock: receipt.blockNumber.toString(),
      state: "sealed",
    };
    store.replaceKey(pendingKey, done);
    return done;
  } catch (err) {
    store.remove(pendingKey);
    throw err;
  }
}

export async function cancelOrder(market: Market, o: LocalOrder) {
  if (o.index === undefined) return;
  await sendWithWallet({
    address: market.auction,
    abi: letheAuctionAbi,
    functionName: "cancel",
    args: [BigInt(o.round), BigInt(o.index)],
  });
  useOrderStore.getState().update(orderKey(o.chainId, o.auction, BigInt(o.round), o.index), { state: "cancelled" });
}

export async function claimFaucet(token: TokenInfo) {
  await sendWithWallet({ address: token.address, abi: testTokenAbi, functionName: "faucet", args: [] });
}

/**
 * Deposit with an EIP-2612 permit (signature + one transaction, no lingering allowance).
 * Falls back to approve + deposit for tokens without permit.
 */
export async function deposit(market: Market, token: TokenInfo, owner: Address, amount: bigint) {
  try {
    const [name, nonce] = await Promise.all([
      readContract(wagmiConfig, { address: token.address, abi: testTokenAbi, functionName: "name" }),
      readContract(wagmiConfig, { address: token.address, abi: testTokenAbi, functionName: "nonces", args: [owner] }),
    ]);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 60);
    const sig = await signTypedData(wagmiConfig, {
      domain: { name, version: "1", chainId: activeChain.id, verifyingContract: token.address },
      types: {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "Permit",
      message: { owner, spender: market.auction, value: amount, nonce, deadline },
    });
    const { v, r, s, yParity } = parseSignature(sig);
    await sendWithWallet({
      address: market.auction,
      abi: letheAuctionAbi,
      functionName: "depositWithPermit",
      args: [token.address, amount, deadline, Number(v ?? BigInt(yParity + 27)), r, s],
    });
  } catch (err) {
    // only fall back when the token itself lacks permit; user rejections propagate
    if (!(err instanceof Error) || !/nonces|name|returned no data/i.test(err.message)) throw err;
    const allowance = await readContract(wagmiConfig, {
      address: token.address,
      abi: erc20Abi,
      functionName: "allowance",
      args: [owner, market.auction],
    });
    if (allowance < amount) {
      await sendWithWallet({ address: token.address, abi: erc20Abi, functionName: "approve", args: [market.auction, amount] });
    }
    await sendWithWallet({ address: market.auction, abi: letheAuctionAbi, functionName: "deposit", args: [token.address, amount] });
  }
}

export async function withdraw(market: Market, token: TokenInfo, amount: bigint) {
  await sendWithWallet({ address: market.auction, abi: letheAuctionAbi, functionName: "withdraw", args: [token.address, amount] });
}

/** Send a little native HYPE to the in-browser reveal helper so it can pay for reveals. */
export async function fundHelper(helper: Address, value: bigint) {
  const hash = await sendTransaction(wagmiConfig, { to: helper, value });
  const receipt = await waitForTransactionReceipt(wagmiConfig, { hash });
  if (receipt.status !== "success") throw new Error("Top-up failed.");
}

export async function chainHasCode(address: Address) {
  const pub = getPublicClient(wagmiConfig);
  const code = await pub?.getCode({ address });
  return !!code && code !== "0x";
}
