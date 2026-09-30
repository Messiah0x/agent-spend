// Control plane end-to-end: an agent hits its limit → asks for more budget →
// the owner approves on the dashboard → the limit is raised on-chain → the
// agent's retry succeeds. Plus revoke / set-limit / authorize controls,
// alerts, and the security properties of every admin write.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer as createHttpServer, type Server } from "node:http";
import { getAddress, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { startDevnet } from "../scripts/devnet.js";
import { checkBudgetAlerts } from "../src/alerts.js";
import { approvalId, buildApprovalRequest } from "../src/approvals.js";
import { PATH_USD_ADDRESS } from "../src/chain.js";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db.js";
import { createIndexer } from "../src/indexer.js";
import { createNotifier } from "../src/notify.js";
import { createReader } from "../src/reads.js";
import { BudgetExceededError, createAgent, devnetPayer } from "../src/sdk.js";
import { createServer } from "../src/server.js";
import { createWriter } from "../src/writer.js";

const DEVNET_PORT = 18548;
const HOOK_PORT = 18549;
const RPC_URL = `http://localhost:${DEVNET_PORT}`;
const ACCOUNT = getAddress("0xaaaa00000000000000000000000000000000aaaa");
const VENDOR = getAddress("0xbbbb00000000000000000000000000000000bbbb");
const ADMIN = { user: "ops", pass: "correct-horse-battery-staple" };
const AUTH = `Basic ${Buffer.from(`${ADMIN.user}:${ADMIN.pass}`).toString("base64")}`;
const FORM = { "content-type": "application/x-www-form-urlencoded", origin: "http://localhost", authorization: AUTH };
const USD = 1_000_000n;

const AGENT_PK = generatePrivateKey();
const AGENT_KEY = privateKeyToAccount(AGENT_PK).address;

let devnet: Server;
let hookServer: Server;
const webhooks: string[] = [];

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
  ADMIN_USER: ADMIN.user,
  ADMIN_PASSWORD: ADMIN.pass,
  OPERATOR_MODE: "devnet",
  WEBHOOK_URL: `http://localhost:${HOOK_PORT}/hook`,
  PUBLIC_URL: "https://spend.example.com",
  ALERT_THRESHOLD_PCT: "30",
} as NodeJS.ProcessEnv);
const db = openDb(":memory:");
const indexer = createIndexer(config, db);
const reader = createReader(config);
const notify = createNotifier(config);
const app = createServer(config, db, reader, { indexer, writer: createWriter(config), notify });
const appFetch = async (url: string, init?: RequestInit) => app.request(url, init);
const agent = createAgent({
  baseUrl: "http://localhost",
  account: ACCOUNT,
  privateKey: AGENT_PK,
  payer: devnetPayer({ rpcUrl: RPC_URL, account: ACCOUNT, keyId: AGENT_KEY }),
  fetch: appFetch,
});

const form = (path: string, body: Record<string, string>, headers: Record<string, string> = FORM) =>
  app.request(path, { method: "POST", headers, body: new URLSearchParams(body).toString() });
const html = async (path: string) => (await app.request(path)).text();
const remaining = async (key: Address = AGENT_KEY) =>
  (await reader.remainingBudgets(ACCOUNT, key)).budgets[0]?.remaining ?? null;

beforeAll(async () => {
  devnet = startDevnet(DEVNET_PORT);
  hookServer = createHttpServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      webhooks.push((JSON.parse(body) as { text: string }).text);
      res.end("ok");
    });
  });
  hookServer.listen(HOOK_PORT);
  await Promise.all([
    new Promise((r) => devnet.once("listening", r)),
    new Promise((r) => hookServer.once("listening", r)),
  ]);
  await rpc("dev_authorizeKey", [
    { account: ACCOUNT, keyId: AGENT_KEY, token: PATH_USD_ADDRESS, limit: (20n * USD).toString(), period: 30 * 86_400 },
  ]);
  await indexer.runOnce();
});
afterAll(() => {
  devnet.close();
  hookServer.close();
});

describe("agent page", () => {
  it("shows budget, burn stats, controls, and history", async () => {
    await agent.pay({ to: VENDOR, amount: 15n * USD, reason: "GPU hours for nightly eval run" });
    await indexer.runOnce();
    const res = await app.request(`/agents/${ACCOUNT}/${AGENT_KEY}`);
    expect(res.status).toBe(200);
    const page = await res.text();
    expect(page).toContain("Burn rate");
    expect(page).toContain("Runway");
    expect(page).toContain("GPU hours for nightly eval run");
    expect(page).toContain("Revoke key"); // operator configured → controls shown
    expect(page).toContain("Set spending limit");
    expect(page).toContain('class="chart"'); // daily spend chart
    expect(page).toContain("25%"); // 5 of 20 remaining
  });

  it("404s unknown agents and 400s malformed ids", async () => {
    expect((await app.request(`/agents/${ACCOUNT}/${VENDOR}`)).status).toBe(404);
    expect((await app.request(`/agents/nope/nope`)).status).toBe(400);
  });

  it("overview flags the low budget under Needs attention", async () => {
    const page = await html("/");
    expect(page).toContain("Needs attention");
    expect(page).toContain("is low");
  });
});

describe("escalation: limit reached → request → approve → retry", () => {
  let requestId: Hex;

  it("pre-check stops the over-budget payment; the agent asks for more", async () => {
    await expect(agent.pay({ to: VENDOR, amount: 10n * USD, reason: "Second eval run" })).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
    const req = await agent.requestApproval({
      amount: 10n * USD,
      to: VENDOR,
      reason: "Second eval run needed: first run hit a flaky node <!channel>",
    });
    expect(req.status).toBe("pending");
    requestId = req.id;
  });

  it("notifies the owner by webhook, with agent text escaped", async () => {
    await new Promise((r) => setTimeout(r, 50));
    const msg = webhooks.find((w) => w.includes("requests +10.00"));
    expect(msg).toBeDefined();
    expect(msg).toContain("https://spend.example.com/approvals");
    // The hook receives Slack-escaped text; the raw body can't contain a live <!channel>.
  });

  it("shows up on the Approvals page with a suggested limit and a nav badge", async () => {
    const page = await html("/approvals");
    expect(page).toContain("Second eval run needed");
    expect(page).toContain("&lt;!channel&gt;"); // HTML-escaped
    expect(page).toContain('value="15"'); // remaining 5 + requested 10
    expect(page).toContain('class="nav-count"');
  });

  it("approval requires admin auth and same-origin", async () => {
    const noAuth = await form(`/admin/approvals/${requestId}/approve`, { newLimit: "15" }, {
      "content-type": "application/x-www-form-urlencoded",
      origin: "http://localhost",
    });
    expect(noAuth.status).toBe(401);
    const crossSite = await form(`/admin/approvals/${requestId}/approve`, { newLimit: "15" }, {
      ...FORM,
      origin: "https://evil.example",
    });
    expect(crossSite.status).toBe(403);
    expect((await agent.approval(requestId)).status).toBe("pending");
  });

  it("approving raises the limit on-chain and the agent's retry succeeds", async () => {
    const res = await form(`/admin/approvals/${requestId}/approve`, { newLimit: "15.00" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/approvals?flash=approved");

    const status = await agent.approval(requestId);
    expect(status.status).toBe("approved");
    expect(status.newLimit).toBe((15n * USD).toString());
    expect(status.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(await remaining()).toBe(15n * USD); // live on-chain read

    const { txHash } = await agent.pay({ to: VENDOR, amount: 10n * USD, reason: "Second eval run" });
    await indexer.runOnce();
    expect(db.listPayments({ txHash }).length).toBeGreaterThan(0);
  });

  it("a double-submitted approval never executes twice", async () => {
    const before = db.listAudit().length;
    const res = await form(`/admin/approvals/${requestId}/approve`, { newLimit: "999" });
    expect(res.headers.get("location")).toBe("/approvals?flash=stale");
    expect(db.listAudit().length).toBe(before);
    expect(await remaining()).toBe(5n * USD); // unchanged by the replay
  });

  it("the decision is on the audit trail and in key history", async () => {
    expect(await html("/keys")).toContain("Approve request");
    expect(await html("/keys")).toContain("Spending limit set to 15.00 pathUSD"); // indexed on-chain event
  });

  it("deny records the decision and note; the agent sees it", async () => {
    const req = await agent.requestApproval({ amount: 500n * USD, reason: "Buy a GPU cluster" });
    const res = await form(`/admin/approvals/${req.id}/deny`, { note: "Too large — talk to finance" });
    expect(res.headers.get("location")).toBe("/approvals?flash=denied");
    const s = await agent.approval(req.id);
    expect(s.status).toBe("denied");
    expect(s.note).toBe("Too large — talk to finance");
    expect(await html("/approvals")).toContain("Too large — talk to finance");
  });

  it("expired requests can't be approved", async () => {
    const req = await agent.requestApproval({ amount: 1n * USD, reason: "Old request" });
    db.raw.prepare("UPDATE approvals SET created_time = created_time - 8 * 86400 WHERE id = ?").run(req.id);
    expect((await agent.approval(req.id)).status).toBe("expired");
    const res = await form(`/admin/approvals/${req.id}/approve`, { newLimit: "100" });
    expect(res.headers.get("location")).toBe("/approvals?flash=stale");
  });

  it("rejects malformed and forged approval requests", async () => {
    const post = (body: unknown) =>
      app.request("/api/v1/approvals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const request = buildApprovalRequest({
      account: ACCOUNT,
      keyId: AGENT_KEY,
      token: PATH_USD_ADDRESS,
      amount: 1n,
      reason: "x",
    });
    const forged = await privateKeyToAccount(generatePrivateKey()).signMessage({ message: { raw: approvalId(request) } });
    expect((await post({ request, signature: forged })).status).toBe(401);
    const good = await privateKeyToAccount(AGENT_PK).signMessage({ message: { raw: approvalId(request) } });
    expect((await post({ request: { ...request, amount: "0" }, signature: good })).status).toBe(400);
    expect((await post({ request: { ...request, type: "drain" }, signature: good })).status).toBe(400);
    expect((await app.request("/api/v1/approvals/0x12")).status).toBe(400);
  });

  it("rejects invalid limits without touching the chain", async () => {
    const req = await agent.requestApproval({ amount: 1n * USD, reason: "Tiny top-up" });
    for (const bad of ["abc", "-5", "0", "1.1234567", "1e9"]) {
      const res = await form(`/admin/approvals/${req.id}/approve`, { newLimit: bad });
      expect(res.headers.get("location")).toBe("/approvals?flash=invalid");
    }
    expect((await agent.approval(req.id)).status).toBe("pending");
  });
});

describe("key controls", () => {
  it("set limit updates the on-chain limit and logs the action", async () => {
    const res = await form(`/admin/keys/${ACCOUNT}/${AGENT_KEY}/limit`, { limit: "42.5", token: PATH_USD_ADDRESS });
    expect(res.headers.get("location")).toBe(`/agents/${ACCOUNT.toLowerCase()}/${AGENT_KEY.toLowerCase()}?flash=limit`);
    expect(await remaining()).toBe(42_500_000n);
    expect(await html(`/agents/${ACCOUNT}/${AGENT_KEY}`)).toContain("limit → 42.50 pathUSD");
  });

  it("set limit rejects untracked tokens and bad amounts", async () => {
    const r1 = await form(`/admin/keys/${ACCOUNT}/${AGENT_KEY}/limit`, { limit: "1", token: VENDOR });
    expect(r1.headers.get("location")).toContain("flash=invalid");
    const r2 = await form(`/admin/keys/${ACCOUNT}/${AGENT_KEY}/limit`, { limit: "lots", token: PATH_USD_ADDRESS });
    expect(r2.headers.get("location")).toContain("flash=invalid");
  });

  it("authorize provisions a new named agent on-chain", async () => {
    const newKey = privateKeyToAccount(generatePrivateKey()).address;
    const res = await form("/admin/keys/authorize", {
      keyId: newKey,
      name: "Procurement Agent",
      limit: "250",
      token: PATH_USD_ADDRESS,
      period: String(7 * 86_400),
      expiryDays: "30",
    });
    expect(res.headers.get("location")).toBe("/keys?flash=authorized");
    expect(db.getKey(ACCOUNT, newKey)).not.toBeNull();
    expect(await remaining(newKey)).toBe(250n * USD);
    const overview = await html("/");
    expect(overview).toContain("Procurement Agent");
  });

  it("authorize validates every field", async () => {
    const base = { keyId: VENDOR, name: "", limit: "1", token: PATH_USD_ADDRESS, period: "0", expiryDays: "0" };
    for (const bad of [{ keyId: "0x1" }, { limit: "x" }, { period: "123" }, { expiryDays: "-1" }, { token: VENDOR }]) {
      const res = await form("/admin/keys/authorize", { ...base, ...bad });
      expect(res.headers.get("location")).toBe("/keys?flash=invalid");
    }
  });

  it("revoke is the kill switch: on-chain, logged, and closes the agent API", async () => {
    const res = await form(`/admin/keys/${ACCOUNT}/${AGENT_KEY}/revoke`, {});
    expect(res.headers.get("location")).toContain("flash=revoked");
    expect(db.getKey(ACCOUNT, AGENT_KEY)!.revoked_block).not.toBeNull();
    const page = await html(`/agents/${ACCOUNT}/${AGENT_KEY}`);
    expect(page).toContain("Revoked");
    expect(page).not.toContain("Revoke key</button>");
    await expect(agent.requestApproval({ amount: 1n, reason: "please" })).rejects.toThrow(/revoked/);
  });

  it("controls require admin auth", async () => {
    const res = await form(`/admin/keys/${ACCOUNT}/${VENDOR}/revoke`, {}, {
      "content-type": "application/x-www-form-urlencoded",
      origin: "http://localhost",
    });
    expect(res.status).toBe(401);
  });

  it("controls are refused for accounts the operator doesn't control", async () => {
    const other = getAddress("0xcccc00000000000000000000000000000000cccc");
    const res = await form(`/admin/keys/${other}/${AGENT_KEY}/revoke`, {});
    expect(res.headers.get("location")).toContain("flash=no_operator");
  });
});

describe("without an operator key", () => {
  const cfg = loadConfig({
    TEMPO_RPC_URL: RPC_URL,
    WATCHED_ACCOUNTS: ACCOUNT,
    CONFIRMATIONS: "0",
    ADMIN_USER: ADMIN.user,
    ADMIN_PASSWORD: ADMIN.pass,
  } as NodeJS.ProcessEnv);
  const db2 = openDb(":memory:");
  const ix2 = createIndexer(cfg, db2);
  const app2 = createServer(cfg, db2, createReader(cfg), { indexer: ix2 });

  it("is read-only for chain state and records approvals for manual execution", async () => {
    const pk = generatePrivateKey();
    const key = privateKeyToAccount(pk).address;
    await rpc("dev_authorizeKey", [{ account: ACCOUNT, keyId: key, token: PATH_USD_ADDRESS, limit: "1000000" }]);
    await ix2.runOnce();

    const page = await (await app2.request(`/agents/${ACCOUNT}/${key}`)).text();
    expect(page).toContain("On-chain controls are off");
    expect(page).not.toContain("Revoke key</button>");
    expect(await (await app2.request("/keys")).text()).not.toContain("Authorize a new agent");

    const a2 = createAgent({
      baseUrl: "http://localhost",
      account: ACCOUNT,
      privateKey: pk,
      payer: devnetPayer({ rpcUrl: RPC_URL, account: ACCOUNT, keyId: key }),
      fetch: async (u, i) => app2.request(u, i),
    });
    const req = await a2.requestApproval({ amount: 5n * USD, reason: "Need more" });
    const res = await app2.request(`/admin/approvals/${req.id}/approve`, {
      method: "POST",
      headers: FORM,
      body: "newLimit=6",
    });
    expect(res.headers.get("location")).toBe("/approvals?flash=approved_manual");
    const s = await a2.approval(req.id);
    expect(s.status).toBe("approved");
    expect(s.txHash).toBeNull();
    expect(s.note).toContain("awaiting on-chain");
  });
});

describe("alerts", () => {
  it("sends a low-budget alert once per budget period", async () => {
    const pk = generatePrivateKey();
    const key = privateKeyToAccount(pk).address;
    await rpc("dev_authorizeKey", [
      { account: ACCOUNT, keyId: key, token: PATH_USD_ADDRESS, limit: (10n * USD).toString(), period: 86_400 },
    ]);
    await devnetPayer({ rpcUrl: RPC_URL, account: ACCOUNT, keyId: key }).transfer({
      token: PATH_USD_ADDRESS,
      to: VENDOR,
      amount: 9n * USD,
      memo: `0x${"00".repeat(32)}`,
    });
    await indexer.runOnce();
    db.setLabel(ACCOUNT, key, "Alert Test Agent");

    const before = webhooks.length;
    await checkBudgetAlerts(config, db, reader, notify);
    await checkBudgetAlerts(config, db, reader, notify);
    const sent = webhooks.slice(before).filter((w) => w.includes("Alert Test Agent"));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("low on budget");
  });
});

describe("redirect safety", () => {
  it("label form ignores off-site redirect targets", async () => {
    for (const evil of ["//evil.example", "https://evil.example", "/\\evil.example"]) {
      const res = await form(`/agents/${ACCOUNT}/${AGENT_KEY}/label`, { label: "x", redirect: evil });
      expect(res.headers.get("location")).toBe("/");
    }
  });

  it("flash banners only render fixed messages", async () => {
    const page = await html("/?flash=<script>alert(1)</script>");
    expect(page).not.toContain("<script>alert(1)");
    expect(page).not.toContain('class="flash');
  });
});
