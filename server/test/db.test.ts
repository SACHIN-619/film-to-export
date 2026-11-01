import { describe, expect, it } from "vitest";
import { connectDb, createPool, migrate, MissingDatabaseUrlError } from "../src/db.js";
import { memoryDb } from "./helpers.js";

describe("Postgres layer (pg-mem, offline)", () => {
  it("applies the migration once, records it, and seeds the seller", async () => {
    const db = await memoryDb();
    expect(await migrate(db)).toEqual([]); // second run is a no-op
    const applied = await db.all<{ name: string }>("SELECT name FROM schema_migrations");
    expect(applied.map((r) => r.name)).toEqual(["001_init.sql", "002_duty.sql", "003_broker.sql"]);
    const seller = await db.get<{ country: string }>("SELECT country FROM seller WHERE id = 1");
    expect(seller?.country).toBe("IN");
  });

  it("refuses to start without DATABASE_URL, with instructions (no SQLite fallback)", async () => {
    await expect(connectDb(null)).rejects.toBeInstanceOf(MissingDatabaseUrlError);
    await expect(connectDb(null)).rejects.toThrow(/neon\.tech/);
    await expect(connectDb(null)).rejects.toThrow(/Supabase/);
  });

  it("requires TLS for remote hosts and lets our ssl config win over sslmode in the URL", async () => {
    const pool = createPool("postgresql://u:p@ep-cool-1.us-east-2.aws.neon.tech/neondb?sslmode=require");
    const opts = (pool as unknown as { options: { ssl: unknown; connectionString: string } }).options;
    expect(opts.ssl).toEqual({ rejectUnauthorized: true });
    expect(opts.connectionString).not.toContain("sslmode");
    await pool.end();

    const noVerify = createPool("postgresql://u:p@aws-0-ap-south-1.pooler.supabase.com:6543/postgres", { verifyCert: false });
    expect((noVerify as unknown as { options: { ssl: unknown } }).options.ssl).toEqual({ rejectUnauthorized: false });
    await noVerify.end();

    const local = createPool("postgresql://u:p@localhost:5432/fte");
    expect((local as unknown as { options: { ssl: unknown } }).options.ssl).toBeUndefined();
    await local.end();
  });

  it("rejects non-Postgres URLs", () => {
    expect(() => createPool("mysql://u:p@host/db")).toThrow(/postgresql:\/\//);
  });
});

describe("isConnectError (safe-retry classifier)", () => {
  it("retries only connect-phase failures", async () => {
    const { isConnectError } = await import("../src/db.js");
    expect(isConnectError(Object.assign(new AggregateError([Object.assign(new Error(""), { code: "ETIMEDOUT" })]), { code: "ETIMEDOUT" }))).toBe(true);
    expect(isConnectError(new Error("timeout exceeded when trying to connect"))).toBe(true);
    expect(isConnectError(Object.assign(new Error("x"), { code: "ENOTFOUND" }))).toBe(true);
    expect(isConnectError(Object.assign(new Error("dup"), { code: "23505" }))).toBe(false);
    expect(isConnectError(Object.assign(new Error("reset"), { code: "ECONNRESET" }))).toBe(false); // may be mid-query
  });
});
