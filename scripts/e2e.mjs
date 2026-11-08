// End-to-end check against a local anvil chain and a running web app.
//   1. anvil --block-time 1    2. deploy (scripts/local.sh)    3. app on :3000    4. node scripts/e2e.mjs
// Two browser "traders" use a mock EIP-1193 wallet that forwards to anvil's unlocked dev accounts.
// They connect, claim test tokens, enable auto-reveal, seal opposing orders and wait for the fill.
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

// Use the project's playwright if installed, otherwise a global one.
let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  const globalRoot = execSync("npm root -g").toString().trim();
  ({ chromium } = createRequire(import.meta.url)(`${globalRoot}/playwright`));
}

const APP = process.env.APP_URL ?? "http://127.0.0.1:3000";
const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp";

// anvil dev accounts #1 and #2 (public, well-known test keys; never use on a real network)
const ALICE = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const BOB = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

function walletScript(account, rpc) {
  return `
    (() => {
      const account = ${JSON.stringify(account)};
      const rpc = ${JSON.stringify(rpc)};
      let id = 0;
      const listeners = {};
      const call = async (method, params) => {
        const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params: params ?? [] }) });
        const j = await r.json();
        if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; e.data = j.error.data; throw e; }
        return j.result;
      };
      const provider = {
        isMetaMask: false,
        request: async ({ method, params }) => {
          if (method === "eth_requestAccounts" || method === "eth_accounts") return [account];
          if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
          if (method === "wallet_requestPermissions") return [{ parentCapability: "eth_accounts" }];
          if (method === "wallet_getPermissions") return [{ parentCapability: "eth_accounts" }];
          return call(method, params);
        },
        on: (e, f) => ((listeners[e] ??= []).push(f), provider),
        removeListener: (e, f) => { listeners[e] = (listeners[e] ?? []).filter((x) => x !== f); return provider; },
      };
      window.ethereum = provider;
      const info = { uuid: "e2e-" + account, name: "E2E Wallet", icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>", rdns: "dev.lethe.e2e" };
      const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
      window.addEventListener("eip6963:requestProvider", announce);
      announce();
    })();
  `;
}

async function trader(browser, account, name) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 980 } });
  await ctx.addInitScript(walletScript(account, RPC));
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`[${name}] pageerror`, e.message));
  await page.goto(APP);
  // an already-authorised wallet reconnects by itself; otherwise go through the dialog
  const short = page.getByText(account.slice(0, 6)).first();
  const connect = page.getByRole("button", { name: "Connect wallet" }).first();
  await short.waitFor({ timeout: 4_000 }).catch(() => {});
  if (!(await short.isVisible())) {
    await connect.click();
    await page.getByRole("button", { name: "E2E Wallet" }).click();
    await short.waitFor();
  }
  console.log(`[${name}] connected`);
  return { ctx, page, name };
}

async function step(t, label, fn) {
  console.log(`[${t.name}] ${label}`);
  await fn(t.page);
}

async function waitForText(page, text, timeout = 90_000) {
  await page.getByText(text).first().waitFor({ timeout });
}

const browser = await chromium.launch();
try {
  const alice = await trader(browser, ALICE, "alice");
  const bob = await trader(browser, BOB, "bob");

  for (const t of [alice, bob]) {
    await step(t, "claim test tokens", async (p) => {
      await p.getByRole("button", { name: "Get test tokens" }).click();
      // re-runs on the same chain hit the 1-hour faucet cooldown, which is fine
      await p.getByText(/Test tokens received|Faucet already used/).first().waitFor({ timeout: 30_000 });
    });
    await step(t, "turn on auto-reveal", async (p) => {
      await p.getByRole("button", { name: /Turn on · / }).click();
      await waitForText(p, "Auto-reveal on", 30_000);
    });
  }

  // wait for a commit phase with comfortable time left
  await alice.page.getByRole("button", { name: /Seal|Deposit & seal|Enter an amount/ }).first().waitFor({ timeout: 90_000 });

  async function place(t, side, amount, price) {
    await step(t, `${side} ${amount} @ ${price}`, async (p) => {
      if (side === "sell") await p.getByRole("button", { name: "sell", exact: true }).click();
      const inputs = p.locator("section").filter({ has: p.getByRole("button", { name: "sell", exact: true }) }).locator("input");
      await inputs.nth(0).fill(amount);
      await inputs.nth(1).fill(price);
      const cta = p.getByRole("button", { name: new RegExp(`(Deposit & seal|Seal) ${side} order`) });
      await cta.waitFor({ timeout: 60_000 });
      await cta.click();
      await waitForText(p, "Order sealed", 60_000);
    });
  }

  await place(alice, "buy", "2", "31");
  await place(bob, "sell", "2", "29");
  await alice.page.screenshot({ path: `${SHOTS}/lethe-sealed.png` });

  await waitForText(alice.page, "Bought", 120_000);
  await waitForText(bob.page, "Sold", 120_000);
  await alice.page.waitForTimeout(2500);
  await alice.page.screenshot({ path: `${SHOTS}/lethe-filled.png` });
  await bob.page.screenshot({ path: `${SHOTS}/lethe-bob.png` });

  const text = await alice.page
    .locator("section")
    .filter({ has: alice.page.getByRole("heading", { name: "Your orders" }) })
    .innerText();
  console.log("alice orders:\n" + text);
  console.log("E2E PASS");
} catch (e) {
  console.error("E2E FAIL", e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
