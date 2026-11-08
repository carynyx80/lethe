"use client";

import {
  BaseError,
  ContractFunctionRevertedError,
  UserRejectedRequestError,
  type Abi,
  type Address,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type TransactionReceipt,
  type WalletClient,
} from "viem";
import { getPublicClient, simulateContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { wagmiConfig } from "./wagmi";

const FRIENDLY: Record<string, string> = {
  WrongPhase: "That phase just ended. Try again when the next round opens.",
  InsufficientBalance: "Not enough funds in your Lethe account.",
  RoundFull: "This round is full. The next one opens in a few seconds.",
  NotTrader: "Only the trader who sealed this order can do that.",
  BadStatus: "This order has already moved on.",
  CommitmentMismatch: "The saved order details don't match what was sealed.",
  InvalidOrder: "Order is below the minimum size or has a zero price.",
  UnsupportedToken: "That token isn't traded on Lethe.",
  ZeroAmount: "Enter an amount greater than zero.",
  FaucetCooldown: "Faucet already used. You can claim again in an hour.",
  WrongRound: "That round closed before your order landed. Nothing was charged. Try again.",
};

/** Turn any wallet/RPC/contract error into one short sentence a person can act on. */
export function friendlyError(err: unknown): string {
  if (err instanceof BaseError) {
    if (err.walk((e) => e instanceof UserRejectedRequestError)) return "You cancelled in your wallet.";
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    const name = revert?.data?.errorName;
    if (name && FRIENDLY[name]) return FRIENDLY[name];
    const msg = err.shortMessage || err.message;
    if (/insufficient funds/i.test(msg)) return "You need a little HYPE for gas.";
    if (/chain/i.test(msg) && /mismatch|switch/i.test(msg)) return "Switch your wallet to the Elysium network.";
    return msg.split("\n")[0] ?? "Something went wrong.";
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

export function revertName(err: unknown): string | undefined {
  if (!(err instanceof BaseError)) return undefined;
  const revert = err.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
  return revert?.data?.errorName;
}

type Call<abi extends Abi, fn extends ContractFunctionName<abi, "nonpayable" | "payable">> = {
  address: Address;
  abi: abi;
  functionName: fn;
  args: ContractFunctionArgs<abi, "nonpayable" | "payable", fn>;
};

/** Simulate, then ask the connected wallet to sign, then wait for the receipt. Throws on revert. */
export async function sendWithWallet<abi extends Abi, fn extends ContractFunctionName<abi, "nonpayable" | "payable">>(
  call: Call<abi, fn>,
): Promise<TransactionReceipt> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { request } = await simulateContract(wagmiConfig, call as any);
  const hash = await writeContract(wagmiConfig, request);
  const receipt = await waitForTransactionReceipt(wagmiConfig, { hash });
  if (receipt.status !== "success") throw new Error("Transaction reverted.");
  return receipt;
}

/** Same flow, signed silently by the in-browser helper key (gas only). */
export async function sendWithHelper<abi extends Abi, fn extends ContractFunctionName<abi, "nonpayable" | "payable">>(
  client: WalletClient,
  call: Call<abi, fn>,
): Promise<TransactionReceipt> {
  const pub = getPublicClient(wagmiConfig);
  if (!pub || !client.account) throw new Error("No RPC connection.");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { request } = await pub.simulateContract({ ...(call as any), account: client.account });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hash = await client.writeContract(request as any);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Transaction reverted.");
  return receipt;
}
