import { test } from "node:test";
import assert from "node:assert/strict";
import { buyLock, fromPrice, pretty, toPrice } from "./units.ts";

test("price round-trips for 18/6 decimals", () => {
  const p = toPrice("31.5", 18, 6);
  assert.equal(p, 31_500_000n);
  assert.equal(fromPrice(p, 18, 6), "31.5");
});

test("buy lock rounds up", () => {
  assert.equal(buyLock(10n ** 18n, 30_000_000n), 30_000_000n);
  assert.equal(buyLock(1n, 30_000_000n), 1n);
});

test("pretty groups and trims", () => {
  assert.equal(pretty(1_234_500_000n, 6), "1,234.5");
  assert.equal(pretty(10n ** 18n, 18), "1");
});
