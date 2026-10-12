// Consistent, online SQLite backup (safe with WAL and active readers/writers).
// Usage: npm run db:backup -- /data/agent-spend.db /backups
// Keep the backup destination on separate durable storage; a backup on the
// same Railway volume does not protect against volume loss.
import Database from "better-sqlite3";
import { mkdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const [sourceArg, destArg] = process.argv.slice(2);
if (!sourceArg || !destArg) {
  console.error("Usage: npm run db:backup -- <source.db> <backup-directory>");
  process.exit(2);
}
const source = resolve(sourceArg);
const directory = resolve(destArg);
if (source === directory || directory.startsWith(source + "/")) throw new Error("Invalid backup destination");
statSync(source); // Refuse to create an empty source database by mistake.
mkdirSync(directory, { recursive: true });
const name = "caula-" + new Date().toISOString().replace(/[:.]/g, "-") + ".db";
const destination = join(directory, name);
const db = new Database(source, { readonly: true, fileMustExist: true });
try {
  await db.backup(destination);
  const check = new Database(destination, { readonly: true, fileMustExist: true });
  try {
    const result = check.pragma("integrity_check", { simple: true });
    if (result !== "ok") throw new Error("Backup integrity check failed: " + result);
    console.log("Verified SQLite backup:", destination);
  } finally {
    check.close();
  }
} finally {
  db.close();
}
