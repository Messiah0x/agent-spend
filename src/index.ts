import { serve } from "@hono/node-server";
import { loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { createIndexer } from "./indexer.js";
import { createReader } from "./reads.js";
import { createServer } from "./server.js";

const config = loadConfig();
const db = openDb(config.dbPath);
const indexer = createIndexer(config, db);
const reader = createReader(config);
const app = createServer(config, db, reader);

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`agent-spend dashboard: http://localhost:${info.port}`);
  console.log(`watching ${config.watchedAccounts.length} account(s) on chain ${config.chainId} via ${config.rpcUrl}`);
});

void indexer.start();
