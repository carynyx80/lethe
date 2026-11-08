export * from "./abi.ts";
export * from "./chains.ts";
export * from "./units.ts";

/** Mirrors LetheAuction.Phase. */
export const Phase = { Pending: 0, Commit: 1, Reveal: 2, Settleable: 3, Settled: 4 } as const;
/** Mirrors LetheAuction.Status. */
export const Status = { None: 0, Committed: 1, Revealed: 2, Cancelled: 3 } as const;
