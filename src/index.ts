import { serve } from "@hono/node-server";
import { checkBudgetAlerts } from "./alerts.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { helpContent, helpSeo } from "./help.js";
import { createIndexer } from "./indexer.js";
import { createNotifier } from "./notify.js";
import { onboardingPanel } from "./onboarding.js";
import { createReader } from "./reads.js";
import { createServer } from "./server.js";
import { layout } from "./ui.js";
import { createWriter } from "./writer.js";

const config = loadConfig();
const db = openDb(config.dbPath);
const indexer = createIndexer(config, db);
const reader = createReader(config);
const writer = createWriter(config);
const notify = createNotifier(config);
const app = createServer(config, db, reader, { indexer, writer, notify });
const network =
  config.chainId === 42431 ? "Tempo Moderato" : config.chainId === 4217 ? "Tempo" : `Chain ${config.chainId}`;

app.get("/getting-started", (c) =>
  c.html(
    layout(
      "Getting started",
      { active: "overview", network, pendingApprovals: db.pendingApprovalCount() },
      `<h1 class="page-title">Getting started</h1><p class="page-sub">Set up controlled AI agent spending on ${network}.</p>${onboardingPanel({
        agentCount: db.listKeys().length,
        paymentCount: db.paymentCount(),
        pendingApprovals: db.pendingApprovalCount(),
        network,
      })}`,
      c.get("nonce"),
    ),
  ),
);

// Public product education. This route intentionally lives outside the private
// dashboard information architecture so operators can learn the product in
// plain language without exposing any account-specific data.
app.get("/help", (c) =>
  c.html(
    layout(
      helpSeo.title,
      { active: "overview", network, pendingApprovals: db.pendingApprovalCount() },
      helpContent({ network }),
      c.get("nonce"),
    ),
  ),
);

if (!config.adminUser || !config.adminPassword) {
  console.warn("ADMIN_USER/ADMIN_PASSWORD not set: admin write routes are disabled (fail closed).");
} else if (config.adminPassword.length < 12) {
  console.warn("ADMIN_PASSWORD is shorter than 12 characters; use a long random secret on public deployments.");
}
if (writer) {
  console.log(`on-chain controls enabled for ${writer.account} (operator: ${writer.mode} key)`);
  if (writer.mode === "root") {
    console.warn("OPERATOR_MODE=root keeps the account's root key on this server — use an admin access key outside of testnets.");
  }
}

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`agent-spend dashboard: http://localhost:${info.port}`);
  console.log(`watching ${config.watchedAccounts.length} account(s) on chain ${config.chainId}`);
});

void indexer.start();

// Low-budget alerts: checked once a minute, each sent once per budget period.
const alertTimer = setInterval(() => {
  checkBudgetAlerts(config, db, reader, notify).catch((err) =>
    console.warn("[alerts] check failed:", err instanceof Error ? err.message : err),
  );
}, 60_000);

function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  indexer.stop();
  clearInterval(alertTimer);
  server.close(() => {
    db.raw.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
