// Hardening: security headers, CSRF, input validation, Activity-feed
// classification (memo dedupe + fee rows), and reorg recovery.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { keccak256, toHex, getAddress } from "viem";
import type { Server } from "node:http";
import { startDevnet } from "../scripts/devnet.js";
import { PATH_USD_ADDRESS } from "../src/chain.js";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db.js";
import { createIndexer } from "../src/indexer.js";
import { createReader } from "../src/reads.js";
import { createServer } from "../src/server.js";

const DEVNET_PORT = 18546;
const RPC_URL = `http://localhost:${DEVNET_PORT}`;
const ACCOUNT = getAddress("0x5555555555555555555555555555555555555555");
const AGENT_KEY = getAddress("0x6666666666666666666666666666666666666666");
const VENDOR = getAddress("0x7777777777777777777777777777777777777777");
const ADMIN = { user: "admin", pass: "test-only-secret-123" };
const AUTH = `Basic ${Buffer.from(`${ADMIN.user}:${ADMIN.pass}`).toString("base64")}`;
const FORM = "application/x-www-form-urlencoded";

let devnet: Server;

async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.result as T;
}

beforeAll(async () => {
  devnet = startDevnet(DEVNET_PORT);
  await new Promise((r) => devnet.once("listening", r));
});
afterAll(() => devnet.close());

const config = loadConfig({
  TEMPO_RPC_URL: RPC_URL,
  WATCHED_ACCOUNTS: ACCOUNT,
  CONFIRMATIONS: "0",
  ADMIN_USER: ADMIN.user,
  ADMIN_PASSWORD: ADMIN.pass,
} as NodeJS.ProcessEnv);
const db = openDb(":memory:");
const indexer = createIndexer(config, db);
const app = createServer(config, db, createReader(config), indexer);

describe("security headers", () => {
  it("sets a nonce-based CSP that matches the inline style and script", async () => {
    const res = await app.request("/");
    const csp = res.headers.get("content-security-policy")!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    const nonce = /'nonce-([^']+)'/.exec(csp)![1]!;
    const html = await res.text();
    expect(html).toContain(`<style nonce="${nonce}">`);
    expect(html).toContain(`<script nonce="${nonce}">`);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("ships dark mode: system-following tokens, a forced override, and a nonce'd theme script", async () => {
    const res = await app.request("/");
    const nonce = /'nonce-([^']+)'/.exec(res.headers.get("content-security-policy")!)![1]!;
    const html = await res.text();
    expect(html).toContain("@media (prefers-color-scheme: dark)");
    expect(html).toContain(':root[data-theme="dark"]');
    expect(html).toContain('class="theme-toggle"');
    // Every inline script carries the nonce, or the CSP would block the theme switch.
    const scripts = html.match(/<script[^>]*>/g)!;
    expect(scripts.length).toBeGreaterThanOrEqual(2);
    for (const tag of scripts) expect(tag).toBe(`<script nonce="${nonce}">`);
    // No inline style attributes (the CSP would block them).
    expect(html).not.toMatch(/\sstyle="/);
  });

  it("uses a fresh nonce per request", async () => {
    const a = (await app.request("/")).headers.get("content-security-policy");
    const b = (await app.request("/")).headers.get("content-security-policy");
    expect(a).not.toBe(b);
  });

  it("renders a 404 page for unknown routes", async () => {
    const res = await app.request("/nope");
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("Page not found");
  });
});

describe("CSRF and input validation on write routes", () => {
  const path = `/agents/${ACCOUNT.toLowerCase()}/${AGENT_KEY.toLowerCase()}/label`;

  it("rejects a cross-site form post even with valid credentials", async () => {
    const res = await app.request(path, {
      method: "POST",
      headers: { "content-type": FORM, authorization: AUTH, origin: "https://evil.example" },
      body: "label=Pwned",
    });
    expect(res.status).toBe(403);
    expect(db.listLabels().size).toBe(0);
  });

  it("rejects a form post with no Origin at all", async () => {
    const res = await app.request(path, {
      method: "POST",
      headers: { "content-type": FORM, authorization: AUTH },
      body: "label=Pwned",
    });
    expect(res.status).toBe(403);
  });

  it("accepts same-origin posts (Origin host or Sec-Fetch-Site)", async () => {
    const viaOrigin = await app.request(path, {
      method: "POST",
      headers: { "content-type": FORM, authorization: AUTH, origin: "http://localhost" },
      body: "label=Ops",
    });
    expect(viaOrigin.status).toBe(302);
    const viaFetchSite = await app.request(path, {
      method: "POST",
      headers: { "content-type": FORM, authorization: AUTH, "sec-fetch-site": "same-origin" },
      body: "label=Ops",
    });
    expect(viaFetchSite.status).toBe(302);
  });

  it("accepts the Origin of a TLS-terminating proxy (host match, scheme differs)", async () => {
    const res = await app.request(path, {
      method: "POST",
      headers: {
        "content-type": FORM,
        authorization: AUTH,
        origin: "https://dash.example.com",
        "x-forwarded-host": "dash.example.com",
      },
      body: "label=Ops",
    });
    expect(res.status).toBe(302);
  });

  it("rejects non-address route params", async () => {
    const res = await app.request("/agents/not-an-address/0x123/label", {
      method: "POST",
      headers: { "content-type": FORM, authorization: AUTH, origin: "http://localhost" },
      body: "label=x",
    });
    expect(res.status).toBe(400);
  });

  it("escapes agent labels (no stored XSS)", async () => {
    await app.request(path, {
      method: "POST",
      headers: { "content-type": FORM, authorization: AUTH, origin: "http://localhost" },
      body: `label=${encodeURIComponent(`<script>alert('x')</script>`)}`,
    });
    await rpc("dev_authorizeKey", [
      { account: ACCOUNT, keyId: AGENT_KEY, token: PATH_USD_ADDRESS, limit: "100000000", period: 0 },
    ]);
    await indexer.runOnce();
    const html = await (await app.request("/")).text();
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
  });

  it("rejects oversized request bodies", async () => {
    const res = await app.request(path, {
      method: "POST",
      headers: { "content-type": FORM, authorization: AUTH, origin: "http://localhost" },
      body: `label=${"a".repeat(64 * 1024)}`,
    });
    expect(res.status).toBe(413);
  });
});

describe("activity feed classification", () => {
  it("shows a memo payment once and folds the per-tx fee debit into it", async () => {
    const memo = keccak256(toHex("dedupe check"));
    await rpc("dev_pay", [
      {
        account: ACCOUNT,
        keyId: AGENT_KEY,
        token: PATH_USD_ADDRESS,
        to: VENDOR,
        amount: "10000000",
        memo,
        fee: "5903",
      },
    ]);
    await indexer.runOnce();

    const rows = db.listPayments();
    const payments = rows.filter((r) => r.kind === "payment");
    const fees = rows.filter((r) => r.kind === "fee");
    expect(payments).toHaveLength(1); // not fanned out across Transfer + TransferWithMemo
    expect(payments[0]!.memo).toBe(memo); // memo-bearing transfer preferred
    expect(payments[0]!.to_addr).toBe(VENDOR.toLowerCase());
    expect(fees).toHaveLength(1);
    expect(fees[0]!.amount).toBe("5903");
    expect(db.paymentCount()).toBe(1); // fee debit is not a payment

    // Total spent still includes the fee: it's what reconciles with on-chain remaining.
    const total = db.spendTotals().get(`${ACCOUNT.toLowerCase()}|${AGENT_KEY.toLowerCase()}|${PATH_USD_ADDRESS.toLowerCase()}`);
    expect(total).toBe(10_005_903n);

    const html = await (await app.request("/activity")).text();
    expect(html).toContain("+ 0.005903 fee"); // fee folded into its payment row
    expect(html.match(/−10\.00/g)).toHaveLength(1);
  });
});

describe("reorg recovery", () => {
  it("drops orphaned rows and re-indexes the canonical chain", async () => {
    await rpc("dev_pay", [
      { account: ACCOUNT, keyId: AGENT_KEY, token: PATH_USD_ADDRESS, to: VENDOR, amount: "1000000" },
    ]);
    await indexer.runOnce();
    const before = db.listPayments().filter((r) => r.kind === "payment").length;

    // The block holding that payment is replaced by an empty one.
    await rpc("dev_reorg", [{ depth: 1 }]);
    await indexer.runOnce();

    const after = db.listPayments().filter((r) => r.kind === "payment").length;
    expect(after).toBe(before - 1);
    expect(db.listKeys()).toHaveLength(1); // earlier, still-canonical history intact
  });
});

describe("healthz", () => {
  it("reports indexer progress without leaking RPC details", async () => {
    const body = (await (await app.request("/healthz")).json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(typeof body.lastIndexedBlock).toBe("number");
    expect(JSON.stringify(body)).not.toContain(RPC_URL);
  });
});
