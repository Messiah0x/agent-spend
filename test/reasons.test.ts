// Reasons ledger end-to-end: an agent pays through the SDK with a reason →
// the dashboard shows the reason, verified against the on-chain payment.
// Also covers the agent API's authentication and the MCP tool surface.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getAddress, keccak256, toHex, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Server } from "node:http";
import { startDevnet } from "../scripts/devnet.js";
import { PATH_USD_ADDRESS } from "../src/chain.js";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db.js";
import { createIndexer } from "../src/indexer.js";
import { createMcpHandler } from "../src/mcp.js";
import { buildReasonRecord, canonicalJson, reasonMemo } from "../src/reasons.js";
import { createReader } from "../src/reads.js";
import { BudgetExceededError, createAgent, devnetPayer } from "../src/sdk.js";
import { createServer } from "../src/server.js";

const DEVNET_PORT = 18547;
const RPC_URL = `http://localhost:${DEVNET_PORT}`;
const ACCOUNT = getAddress("0x8888888888888888888888888888888888888888");
const VENDOR = getAddress("0x9999999999999999999999999999999999999999");
const AGENT_PK = generatePrivateKey();
const AGENT_KEY = privateKeyToAccount(AGENT_PK).address;
const USD = 1_000_000n;

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

const config = loadConfig({
  TEMPO_RPC_URL: RPC_URL,
  WATCHED_ACCOUNTS: ACCOUNT,
  CONFIRMATIONS: "0",
} as NodeJS.ProcessEnv);
const db = openDb(":memory:");
const indexer = createIndexer(config, db);
const app = createServer(config, db, createReader(config), indexer);
const appFetch = async (url: string, init?: RequestInit) => app.request(url, init);

const agent = createAgent({
  baseUrl: "http://localhost",
  account: ACCOUNT,
  privateKey: AGENT_PK,
  payer: devnetPayer({ rpcUrl: RPC_URL, account: ACCOUNT, keyId: AGENT_KEY, fee: 5903n }),
  fetch: appFetch,
});

beforeAll(async () => {
  devnet = startDevnet(DEVNET_PORT);
  await new Promise((r) => devnet.once("listening", r));
  await rpc("dev_authorizeKey", [
    { account: ACCOUNT, keyId: AGENT_KEY, token: PATH_USD_ADDRESS, limit: (100n * USD).toString(), period: 86_400 },
  ]);
  await indexer.runOnce();
});
afterAll(() => devnet.close());

describe("reason records", () => {
  it("canonical JSON is key-order independent, so the memo is deterministic", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
    const base = {
      account: ACCOUNT,
      keyId: AGENT_KEY,
      token: PATH_USD_ADDRESS,
      to: VENDOR,
      amount: 5n,
      reason: "x",
      nonce: toHex(new Uint8Array(16)),
    };
    expect(reasonMemo(buildReasonRecord(base))).toBe(reasonMemo(buildReasonRecord(base)));
    // Every field is committed to: changing the amount changes the memo.
    expect(reasonMemo(buildReasonRecord({ ...base, amount: 6n }))).not.toBe(reasonMemo(buildReasonRecord(base)));
  });

  it("fresh nonces give identical payments distinct memos", () => {
    const p = { account: ACCOUNT, keyId: AGENT_KEY, token: PATH_USD_ADDRESS, to: VENDOR, amount: 5n, reason: "x" };
    expect(reasonMemo(buildReasonRecord(p))).not.toBe(reasonMemo(buildReasonRecord(p)));
  });
});

describe("agent pays with a reason → dashboard explains and verifies it", () => {
  let txHash: Hex;
  let memo: Hex;

  it("SDK pay: registers a signed reason, pays with its hash as memo", async () => {
    ({ txHash, memo } = await agent.pay({
      to: VENDOR,
      amount: 12_500_000n,
      reason: "LLM inference credits, batch #4821",
      context: { realm: "api.inference.example", externalId: "inv_4821" },
    }));
    await indexer.runOnce();
    const payments = db.listPayments({ memo });
    expect(payments.find((p) => p.kind === "payment")?.tx_hash).toBe(txHash);
  });

  it("Activity shows the reason with a Verified badge", async () => {
    const html = await (await app.request("/activity")).text();
    expect(html).toContain("LLM inference credits, batch #4821");
    expect(html).toContain("Verified");
    expect(html).toContain(`/payments/${txHash}`);
  });

  it("payment page shows the full record, signer, and proof", async () => {
    const res = await app.request(`/payments/${txHash}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("LLM inference credits, batch #4821");
    expect(html).toContain("inv_4821");
    expect(html).toContain(memo);
    expect(html).toContain(AGENT_KEY); // recovered signer
    expect(html).toContain("this agent's access key");
    expect(html).toContain("Network fee"); // the per-tx fee debit, shown alongside
  });

  it("JSON API exposes the reason and verdict", async () => {
    const res = await app.request(`/api/v1/payments?keyId=${AGENT_KEY}`);
    const { payments } = (await res.json()) as { payments: any[] };
    const p = payments.find((x) => x.kind === "payment");
    expect(p.reason.text).toBe("LLM inference credits, batch #4821");
    expect(p.reasonVerdict).toBe("verified");

    const r = (await (await app.request(`/api/v1/reasons/${memo}`)).json()) as any;
    expect(r.status).toBe("verified");
    expect(reasonMemo(r.record)).toBe(memo); // anyone can re-hash and check
  });

  it("flags a payment that doesn't match its signed reason", async () => {
    // Agent registers a reason for 1.00 but actually sends 9.00 with that memo.
    const { memo: m } = await agent.registerReason({ to: VENDOR, amount: 1n * USD, reason: "Small data pull" });
    const { txHash: tx } = await devnetPayer({ rpcUrl: RPC_URL, account: ACCOUNT, keyId: AGENT_KEY }).transfer({
      token: PATH_USD_ADDRESS,
      to: VENDOR,
      amount: 9n * USD,
      memo: m,
    });
    await indexer.runOnce();
    const html = await (await app.request(`/payments/${tx}`)).text();
    expect(html).toContain("Mismatch");
    expect(html).toContain("amount differs");
  });

  it("payment without a reason on file shows the raw memo", async () => {
    const rawMemo = keccak256(toHex("no record"));
    const { txHash: tx } = await devnetPayer({ rpcUrl: RPC_URL, account: ACCOUNT, keyId: AGENT_KEY }).transfer({
      token: PATH_USD_ADDRESS,
      to: VENDOR,
      amount: 1n,
      memo: rawMemo,
    });
    await indexer.runOnce();
    expect(await (await app.request(`/payments/${tx}`)).text()).toContain("No reason on file");
  });

  it("budget pre-check refuses before anything is sent", async () => {
    const before = db.listPayments().length;
    await expect(agent.pay({ to: VENDOR, amount: 1_000n * USD, reason: "Too big" })).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
    await indexer.runOnce();
    expect(db.listPayments().length).toBe(before);
  });
});

describe("agent API authentication", () => {
  const post = (body: unknown, contentType = "application/json") =>
    app.request("/api/v1/reasons", {
      method: "POST",
      headers: { "content-type": contentType },
      body: JSON.stringify(body),
    });
  const record = (overrides: Partial<Parameters<typeof buildReasonRecord>[0]> = {}) =>
    buildReasonRecord({
      account: ACCOUNT,
      keyId: AGENT_KEY,
      token: PATH_USD_ADDRESS,
      to: VENDOR,
      amount: 1n,
      reason: "test",
      ...overrides,
    });

  it("rejects a signature from a different key (impersonation)", async () => {
    const r = record();
    const signature = await privateKeyToAccount(generatePrivateKey()).signMessage({ message: { raw: reasonMemo(r) } });
    expect((await post({ record: r, signature })).status).toBe(401);
  });

  it("rejects a key the account never authorized", async () => {
    const stranger = generatePrivateKey();
    const r = record({ keyId: privateKeyToAccount(stranger).address });
    const signature = await privateKeyToAccount(stranger).signMessage({ message: { raw: reasonMemo(r) } });
    const res = await post({ record: r, signature });
    expect(res.status).toBe(403);
  });

  it("rejects accounts this instance doesn't watch", async () => {
    const r = record({ account: getAddress("0x1234567890123456789012345678901234567890") });
    const signature = await privateKeyToAccount(AGENT_PK).signMessage({ message: { raw: reasonMemo(r) } });
    expect((await post({ record: r, signature })).status).toBe(403);
  });

  it("rejects malformed records, unknown fields, untracked tokens, wrong content type", async () => {
    const r = record();
    const signature = await privateKeyToAccount(AGENT_PK).signMessage({ message: { raw: reasonMemo(r) } });
    expect((await post({ record: { ...r, extra: "x" }, signature })).status).toBe(400);
    expect((await post({ record: { ...r, reason: "x".repeat(501) }, signature })).status).toBe(400);
    expect((await post({ record: { ...r, amount: "-1" }, signature })).status).toBe(400);
    const badToken = record({ token: getAddress("0x20c0000000000000000000000000000000000abc") });
    expect((await post({ record: badToken, signature })).status).toBe(400);
    expect((await post({ record: r, signature }, "text/plain")).status).toBe(403); // CSRF guard: simple cross-site POST
    const noJson = await app.request("/api/v1/reasons", {
      method: "POST",
      headers: { "content-type": "application/xml" },
      body: "<x/>",
    });
    expect(noJson.status).toBe(415);
  });

  it("is idempotent for the same signed record", async () => {
    const r = record();
    const signature = await privateKeyToAccount(AGENT_PK).signMessage({ message: { raw: reasonMemo(r) } });
    expect((await post({ record: r, signature })).status).toBe(201);
    expect((await post({ record: r, signature })).status).toBe(200);
  });

  it("rejects writes from a revoked key", async () => {
    const pk = generatePrivateKey();
    const key = privateKeyToAccount(pk).address;
    await rpc("dev_authorizeKey", [{ account: ACCOUNT, keyId: key, token: PATH_USD_ADDRESS, limit: "1000" }]);
    await rpc("dev_revokeKey", [{ account: ACCOUNT, keyId: key }]);
    await indexer.runOnce();
    const r = record({ keyId: key });
    const signature = await privateKeyToAccount(pk).signMessage({ message: { raw: reasonMemo(r) } });
    const res = await post({ record: r, signature });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toContain("revoked");
  });

  it("API read routes validate input and 404 cleanly", async () => {
    expect((await app.request("/api/v1/agents/nope/0x1")).status).toBe(400);
    expect((await app.request(`/api/v1/reasons/0x1234`)).status).toBe(400);
    expect((await app.request(`/api/v1/reasons/${keccak256(toHex("missing"))}`)).status).toBe(404);
    expect((await app.request("/api/v1/nope")).status).toBe(404);
  });
});

describe("MCP server", () => {
  const handle = createMcpHandler(agent);
  const call = (method: string, params?: Record<string, unknown>) =>
    handle({ jsonrpc: "2.0", id: 1, method, params }) as Promise<any>;

  it("initializes and lists tools", async () => {
    const init = await call("initialize", { protocolVersion: "2025-06-18", capabilities: {} });
    expect(init.result.serverInfo.name).toBe("agent-spend");
    expect(await handle({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    const list = await call("tools/list");
    expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual(["get_budget", "pay"]);
  });

  it("get_budget reports the live on-chain budget", async () => {
    const res = await call("tools/call", { name: "get_budget", arguments: {} });
    expect(res.result.content[0].text).toMatch(/pathUSD remaining/);
  });

  it("pay tool pays with a reason that lands on the dashboard", async () => {
    const res = await call("tools/call", {
      name: "pay",
      arguments: { to: VENDOR, amount: "2.25", reason: "Weather API, 1k calls", externalId: "wx-77" },
    });
    expect(res.result.isError).toBeUndefined();
    expect(res.result.content[0].text).toContain("Paid 2.25");
    await indexer.runOnce();
    expect(await (await app.request("/activity")).text()).toContain("Weather API, 1k calls");
  });

  it("pay tool reports validation and budget errors as tool errors", async () => {
    const bad = await call("tools/call", { name: "pay", arguments: { to: "nope", amount: "1", reason: "x" } });
    expect(bad.result.isError).toBe(true);
    const tooBig = await call("tools/call", { name: "pay", arguments: { to: VENDOR, amount: "5000", reason: "x" } });
    expect(tooBig.result.isError).toBe(true);
    expect(tooBig.result.content[0].text).toContain("Nothing was sent");
    const unknown = await call("nope");
    expect(unknown.error.code).toBe(-32601);
  });
});
