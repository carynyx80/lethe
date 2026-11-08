import { encodeAbiParameters, formatUnits, keccak256, parseUnits, type Address, type Hex } from "viem";

export const PRICE_SCALE = 10n ** 18n;

/** Decimals of the on-chain price: quote base-units per 1e18 base base-units. */
export function priceDecimals(baseDecimals: number, quoteDecimals: number): number {
  const d = quoteDecimals + 18 - baseDecimals;
  if (d < 0) throw new Error("unsupported token decimals");
  return d;
}

/** "31.25" (quote per 1 whole base token) -> on-chain price. */
export function toPrice(human: string, baseDecimals: number, quoteDecimals: number): bigint {
  return parseUnits(human, priceDecimals(baseDecimals, quoteDecimals));
}

export function fromPrice(price: bigint, baseDecimals: number, quoteDecimals: number): string {
  return formatUnits(price, priceDecimals(baseDecimals, quoteDecimals));
}

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

/** Quote locked when a buy order is revealed (contract rounds up). */
export function buyLock(amount: bigint, price: bigint): bigint {
  return ceilDiv(amount * price, PRICE_SCALE);
}

/** Exactly mirrors LetheAuction.commitmentHash. */
export function commitmentHash(args: {
  chainId: number;
  auction: Address;
  round: bigint;
  trader: Address;
  isBuy: boolean;
  price: bigint;
  amount: bigint;
  salt: Hex;
}): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "uint256" },
        { type: "address" },
        { type: "bool" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "bytes32" },
      ],
      [BigInt(args.chainId), args.auction, args.round, args.trader, args.isBuy, args.price, args.amount, args.salt],
    ),
  );
}

/** Human-friendly number: trims trailing zeros and caps fraction digits. Display only. */
export function pretty(value: bigint, decimals: number, maxFraction = 4): string {
  const s = formatUnits(value, decimals);
  const [int, frac = ""] = s.split(".");
  const f = frac.slice(0, maxFraction).replace(/0+$/, "");
  const grouped = (int ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return f ? `${grouped}.${f}` : grouped;
}
