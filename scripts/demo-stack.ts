// One-command local demo: starts the devnet fixture and the dashboard (with
// on-chain controls wired to the fixture) in a single process.
//
//   npm run demo:stack      # then, in another terminal: npm run demo
//
// DEMO ONLY: fixed local admin credentials, devnet operator, throwaway DB.

import { serve } from "@hono/node-server";
import { rmSync } from "node:fs";
import { startDevnet } from "./devnet.js";
import { checkBudgetAlerts } from "../src/alerts.js";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db.js";
import { createIndexer } from "../src/indexer.js";
import { createNotifier } from "../src/notify.js";
import { createReader } from "../src/reads.js";
import { createServer } from "../src/server.js";
import { createWriter } from "../src/writer.js";

const DEVNET_PORT = Number(process.env.DEVNET_PORT ?? "8545");
const PORT = Number(process.env.PORT ?? "3000");
const DB_PATH = "./data/demo-stack.db";
const ADMIN_USER = process.env.ADMIN_USER ?? "demo";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "demo-password";

rmSync(DB_PATH, { force: true });
rmSync(`${DB_PATH}-wal`, { force: true });
rmSync(`${DB_PATH}-shm`, { force: true });

const devnet = startDevnet(DEVNET_PORT);
await new Promise((r) => devnet.once("listening", r));

const config = loadConfig({
  ...process.env,
  WATCHED_ACCOUNTS: "0x1111111111111111111111111111111111111111",
  TEMPO_RPC_URL: `http://localhost:${DEVNET_PORT}`,
  CONFIRMATIONS: "0",
  POLL_INTERVAL_MS: "500",
  DB_PATH,
  PORT: String(PORT),
  ADMIN_USER,
  ADMIN_PASSWORD,
  OPERATOR_MODE: "devnet",
});
const db = openDb(config.dbPath);
const indexer = createIndexer(config, db);
const reader = createReader(config);
const notify = createNotifier(config);
const app = createServer(config, db, reader, { indexer, writer: createWriter(config), notify });

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`devnet fixture:  http://localhost:${DEVNET_PORT}`);
  console.log(`dashboard:       http://localhost:${PORT}`);
  console.log(`admin login:     ${ADMIN_USER} / ${ADMIN_PASSWORD}   (demo only)`);
  console.log(`\nnext: npm run demo   (in another terminal)`);
});
void indexer.start();
setInterval(() => void checkBudgetAlerts(config, db, reader, notify).catch(() => {}), 15_000);
