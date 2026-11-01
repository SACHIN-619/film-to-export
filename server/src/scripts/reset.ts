import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../config.js";
import { connectDb, ensureSeller, MissingDatabaseUrlError } from "../db.js";

const config = loadConfig();

let db;
try {
  db = await connectDb(config.databaseUrl, { verifyCert: config.dbVerifyCert });
} catch (err) {
  console.error(err instanceof MissingDatabaseUrlError ? err.message : `Could not connect to Postgres: ${(err as Error).message}`);
  process.exit(1);
}

// Children first (foreign keys). Only this app's tables are touched.
for (const table of ["invoices", "order_events", "orders", "frames", "items", "batches", "seller"]) {
  await db.run(`DELETE FROM ${table}`);
}
await ensureSeller(db);
await db.close();

// Uploaded photos/frames are on local disk. Only delete a folder that looks like ours.
const uploads = path.join(config.dataDir, "uploads");
if (path.basename(config.dataDir) === "data" || fs.existsSync(uploads)) {
  fs.rmSync(uploads, { recursive: true, force: true });
  fs.rmSync(path.join(config.dataDir, "incoming"), { recursive: true, force: true });
}
console.log("Demo reset: Postgres tables emptied, seller profile re-seeded, local uploads cleared.");
