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
const app = createServer(config, db, reader, indexer);

if (!config.adminUser || !config.adminPassword) {
  console.warn("ADMIN_USER/ADMIN_PASSWORD not set: admin write routes are disabled (fail closed).");
} else if (config.adminPassword.length < 12) {
  console.warn("ADMIN_PASSWORD is shorter than 12 characters; use a long random secret on public deployments.");
}

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`agent-spend dashboard: http://localhost:${info.port}`);
  console.log(`watching ${config.watchedAccounts.length} account(s) on chain ${config.chainId}`);
});

void indexer.start();

function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  indexer.stop();
  server.close(() => {
    db.raw.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
