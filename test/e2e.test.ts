// End-to-end milestone test: an agent makes a Tempo payment → the dashboard
// shows the agent, payment amount, recipient, memo, transaction, and
// remaining budget. Runs against the local devnet fixture, which emits the
// exact ABI-encoded events of the real AccountKeychain/TIP-20 precompiles.

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

const DEVNET_PORT = 18545;
const RPC_URL = `http://localhost:${DEVNET_PORT}`;

const ACCOUNT = getAddress("0x1111111111111111111111111111111111111111");
const AGENT_KEY = getAddress("0x2222222222222222222222222222222222222222");
const VENDOR = getAddress("0x3333333333333333333333333333333333333333");
const REASON = "LLM inference credits, batch #4821";
const MEMO = keccak256(toHex(REASON));

const ADMIN_USER = "admin";
const ADMIN_PASSWORD = "test-only-secret";
const AUTH_HEADER = `Basic ${Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString("base64")}`;

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

afterAll(() => {
  devnet.close();
});

describe("milestone: agent payment appears on the dashboard", () => {
  const config = loadConfig({
    TEMPO_RPC_URL: RPC_URL,
    WATCHED_ACCOUNTS: ACCOUNT,
    DB_PATH: ":memory:",
    CONFIRMATIONS: "0",
    ADMIN_USER,
    ADMIN_PASSWORD,
  } as NodeJS.ProcessEnv);
  const db = openDb(":memory:");
  const indexer = createIndexer(config, db);
  const reader = createReader(config);
  const app = createServer(config, db, reader);

  it("indexes a key authorization and a payment", async () => {
    await rpc("dev_authorizeKey", [
      {
        account: ACCOUNT,
        keyId: AGENT_KEY,
        token: PATH_USD_ADDRESS,
        limit: (500_000_000n).toString(), // 500 pathUSD
        period: 30 * 24 * 3600,
      },
    ]);
    const payment = await rpc<{ txHash: string }>("dev_pay", [
      {
        account: ACCOUNT,
        keyId: AGENT_KEY,
        token: PATH_USD_ADDRESS,
        to: VENDOR,
        amount: (12_500_000n).toString(), // 12.50 pathUSD
        memo: MEMO,
      },
    ]);

    const indexed = await indexer.runOnce();
    expect(indexed).toBeGreaterThan(0);

    const keys = db.listKeys();
    expect(keys).toHaveLength(1);
    expect(keys[0]!.key_id).toBe(AGENT_KEY.toLowerCase());

    const payments = db.listPayments();
    expect(payments).toHaveLength(1);
    expect(payments[0]!.amount).toBe("12500000");
    expect(payments[0]!.to_addr).toBe(VENDOR.toLowerCase());
    expect(payments[0]!.memo).toBe(MEMO);
    expect(payments[0]!.tx_hash).toBe(payment.txHash);
    expect(payments[0]!.remaining).toBe("487500000");
  });

  it("overview page shows the agent with live remaining budget", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("0x2222…2222"); // agent key
    expect(html).toContain("Active"); // status badge
    expect(html).toContain("487.50"); // live remaining budget from eth_call
    expect(html).toContain("12.50"); // total spent
  });

  it("activity page shows amount, recipient, memo, tx, and remaining-after", async () => {
    const res = await app.request("/activity");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("−12.50"); // amount
    expect(html).toContain("0x3333…3333"); // recipient
    expect(html).toContain(MEMO.slice(0, 10)); // memo chip
    expect(html).toContain("487.50"); // remaining after
    const payments = db.listPayments();
    expect(html).toContain(payments[0]!.tx_hash.slice(0, 10)); // tx reference
  });

  it("keys page shows the authorization audit trail", async () => {
    const res = await app.request("/keys");
    const html = await res.text();
    expect(html).toContain("Key authorized");
    expect(html).toContain("0x2222…2222");
  });

  it("agent identity: unnamed agents render as before, by address only", async () => {
    for (const path of ["/", "/activity", "/keys"]) {
      const html = await (await app.request(path)).text();
      expect(html).toContain("0x2222…2222");
      expect(html).not.toContain('<span class="agent-name">');
    }
  });

  it("agent identity: naming an agent from Overview shows the name everywhere, address still visible", async () => {
    const res = await app.request(`/agents/${ACCOUNT.toLowerCase()}/${AGENT_KEY.toLowerCase()}/label`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", authorization: AUTH_HEADER },
      body: `label=${encodeURIComponent("Research Agent")}`,
    });
    expect(res.status).toBe(302);

    for (const path of ["/", "/activity", "/keys"]) {
      const html = await (await app.request(path)).text();
      expect(html).toContain("Research Agent");
      expect(html).toContain("0x2222…2222"); // address remains visible as secondary info
    }
  });

  it("agent identity: renaming replaces the old name everywhere", async () => {
    const res = await app.request(`/agents/${ACCOUNT.toLowerCase()}/${AGENT_KEY.toLowerCase()}/label`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", authorization: AUTH_HEADER },
      body: `label=${encodeURIComponent("Claude Sales Agent")}`,
    });
    expect(res.status).toBe(302);

    for (const path of ["/", "/activity", "/keys"]) {
      const html = await (await app.request(path)).text();
      expect(html).toContain("Claude Sales Agent");
      expect(html).not.toContain("Research Agent");
    }
  });

  it("agent identity: labels are Agent Spend's own data, never sent on-chain", async () => {
    // Naming an agent must not touch the chain: remaining budget, read the
    // same way the dashboard reads it, is unaffected by the rename above.
    const { budgets } = await reader.remainingBudgets(ACCOUNT, AGENT_KEY);
    expect(budgets[0]!.remaining).toBe(487_500_000n);
  });

  it("agent identity: clearing the label (empty string) reverts to address-only display", async () => {
    const res = await app.request(`/agents/${ACCOUNT.toLowerCase()}/${AGENT_KEY.toLowerCase()}/label`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", authorization: AUTH_HEADER },
      body: "label=",
    });
    expect(res.status).toBe(302);

    const html = await (await app.request("/")).text();
    expect(html).not.toContain("Claude Sales Agent");
    expect(html).toContain("0x2222…2222");
  });

  it("agent identity: write route rejects requests with no or wrong credentials", async () => {
    const noAuth = await app.request(`/agents/${ACCOUNT.toLowerCase()}/${AGENT_KEY.toLowerCase()}/label`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "label=Hijacked",
    });
    expect(noAuth.status).toBe(401);

    const wrongAuth = await app.request(`/agents/${ACCOUNT.toLowerCase()}/${AGENT_KEY.toLowerCase()}/label`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${Buffer.from("admin:wrong-password").toString("base64")}`,
      },
      body: "label=Hijacked",
    });
    expect(wrongAuth.status).toBe(401);

    // Neither attempt actually changed anything.
    const html = await (await app.request("/")).text();
    expect(html).not.toContain("Hijacked");
  });

  it("agent identity: write route fails closed when ADMIN_USER/ADMIN_PASSWORD are not configured", async () => {
    const unauthedConfig = loadConfig({
      TEMPO_RPC_URL: RPC_URL,
      WATCHED_ACCOUNTS: ACCOUNT,
      DB_PATH: ":memory:",
      CONFIRMATIONS: "0",
    } as NodeJS.ProcessEnv);
    const unauthedDb = openDb(":memory:");
    const unauthedApp = createServer(unauthedConfig, unauthedDb, createReader(unauthedConfig));

    const res = await unauthedApp.request(`/agents/${ACCOUNT.toLowerCase()}/${AGENT_KEY.toLowerCase()}/label`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "label=Should Not Work",
    });
    expect(res.status).toBe(503);
    expect(unauthedDb.listLabels().size).toBe(0);
  });

  it("indexing is idempotent across restarts from block 0", async () => {
    const db2 = openDb(":memory:");
    const indexer2 = createIndexer(config, db2);
    await indexer2.runOnce();
    await indexer2.runOnce();
    expect(db2.listPayments()).toHaveLength(1);
    expect(db2.listKeys()).toHaveLength(1);
  });

  it("revocation shows as revoked and stops budget reads", async () => {
    await rpc("dev_revokeKey", [{ account: ACCOUNT, keyId: AGENT_KEY }]);
    await indexer.runOnce();
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain("Revoked");
  });
});
