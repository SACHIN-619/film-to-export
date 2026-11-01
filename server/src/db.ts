import fs from "node:fs";
import path from "node:path";
import pg from "pg";

/** The slice of pg.Pool / pg.PoolClient we use. pg-mem's adapter satisfies it too (tests). */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
}
export interface PoolLike extends Queryable {
  connect(): Promise<Queryable & { release(): void }>;
  end(): Promise<void>;
}

/**
 * Thin async wrapper around a Postgres pool. Repositories take a Db; inside
 * tx() they get a Db bound to one client, and nested tx() calls join it.
 */
export class Db {
  private constructor(
    private readonly pool: PoolLike | null,
    private readonly conn: Queryable,
  ) {}

  static fromPool(pool: PoolLike): Db {
    return new Db(pool, pool);
  }

  /**
   * Outside a transaction, retry once when the failure happened while *connecting*
   * (the statement never reached the server), e.g. Neon waking from scale-to-zero.
   */
  private async query(sql: string, params: unknown[]) {
    try {
      return await this.conn.query(sql, params);
    } catch (err) {
      if (!this.pool || !isConnectError(err)) throw err;
      await new Promise((r) => setTimeout(r, 1500));
      return this.conn.query(sql, params);
    }
  }

  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.query(sql, params)).rows as T[];
  }

  async get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return (await this.query(sql, params)).rows[0] as T | undefined;
  }

  /** Returns the number of affected rows. */
  async run(sql: string, params: unknown[] = []): Promise<number> {
    return (await this.query(sql, params)).rowCount ?? 0;
  }

  async tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    if (!this.pool) return fn(this); // already inside a transaction
    const client = await this.pool.connect();
    const inner = new Db(null, client);
    try {
      await client.query("BEGIN");
      const out = await fn(inner);
      await client.query("COMMIT");
      return out;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool?.end();
  }
}

const CONNECT_CODES = new Set(["ETIMEDOUT", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH"]);

/** Errors raised before a statement was sent: safe to retry even for writes. */
export function isConnectError(err: unknown): boolean {
  const e = err as { code?: string; message?: string; errors?: { code?: string }[] } | null;
  if (!e) return false;
  if (e.code && CONNECT_CODES.has(e.code)) return true;
  if (e.errors?.some((x) => x.code && CONNECT_CODES.has(x.code))) return true;
  return /timeout exceeded when trying to connect/i.test(e.message ?? "");
}

export const DEFAULT_SELLER = {
  name: "Kavya Sharma",
  business_name: "Kavya Block Prints (demo seller)",
  address: "14 Sanganer Craft Lane",
  city: "Jaipur, Rajasthan 302029",
  country: "IN",
  email: "seller-demo@example.com",
  iec: "",
};

export class MissingDatabaseUrlError extends Error {
  constructor() {
    super(
      [
        "DATABASE_URL is not set.",
        "",
        "Film-to-Export stores listings, orders and invoices in Postgres (also in SIMULATION mode).",
        "Get a free connection string in about a minute:",
        "  • Neon (recommended): https://neon.tech → New project → Connection string",
        "      postgresql://USER:PASSWORD@ep-xxx.REGION.aws.neon.tech/neondb?sslmode=require",
        "  • Supabase: Project Settings → Database → Connection string (use the pooled one)",
        "",
        "Put it in .env as DATABASE_URL=... (copy .env.example). Step by step: docs/COMMON_STEPS.md → Getting your keys.",
      ].join("\n"),
    );
    this.name = "MissingDatabaseUrlError";
  }
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * Build a pg Pool from DATABASE_URL. TLS is required for any non-local host.
 * sslmode/ssl params are stripped from the URL so our explicit ssl config is what applies.
 */
export function createPool(
  databaseUrl: string,
  opts: { verifyCert?: boolean; max?: number; searchPath?: string } = {},
): pg.Pool {
  const url = new URL(databaseUrl);
  if (!/^postgres(ql)?:$/.test(url.protocol)) throw new Error("DATABASE_URL must start with postgresql://");
  for (const p of ["sslmode", "ssl", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat"]) url.searchParams.delete(p);
  const local = LOCAL_HOSTS.has(url.hostname);
  const pool = new pg.Pool({
    connectionString: url.toString(),
    ssl: local ? undefined : { rejectUnauthorized: opts.verifyCert ?? true },
    max: opts.max ?? 5,
    // Startup parameter, so every (re)connected client gets it. Not for transaction poolers.
    options: opts.searchPath ? `-c search_path=${opts.searchPath}` : undefined,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    keepAlive: true,
  });
  // Serverless Postgres (Neon) drops idle connections; don't let that crash the process.
  pool.on("error", (err) => console.error(`[fte] Postgres idle client error: ${err.message}`));
  return pool;
}

/** Apply every server/migrations/*.sql not yet recorded in schema_migrations. */
export async function migrate(db: Db, dir = path.resolve("server/migrations")): Promise<string[]> {
  const schema = await db.get<{ s: string | null }>("SELECT current_schema() AS s");
  if (schema && !schema.s) {
    throw new Error(
      "The database connection has no usable schema (search_path points nowhere). " +
        'Check the role\'s search_path, e.g. ALTER ROLE <user> SET search_path TO "$user", public.',
    );
  }
  // Look the table up instead of letting a SELECT fail: pg-pool discards a connection on
  // error, and pg-mem (tests) rejects CREATE TABLE IF NOT EXISTS on an existing table.
  const exists = await db.get<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1",
    ["schema_migrations"],
  );
  if (!exists?.n) await db.run("CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const rows = await db.all<{ name: string }>("SELECT name FROM schema_migrations");
  const done = new Set(rows.map((r) => r.name));
  const applied: string[] = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    await db.tx(async (t) => {
      await t.run(sql);
      await t.run("INSERT INTO schema_migrations (name, applied_at) VALUES ($1, $2)", [file, nowIso()]);
    });
    applied.push(file);
  }
  await ensureSeller(db);
  return applied;
}

export async function ensureSeller(db: Db): Promise<void> {
  const s = DEFAULT_SELLER;
  await db.run(
    `INSERT INTO seller (id, name, business_name, address, city, country, email, iec)
     VALUES (1, $1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
    [s.name, s.business_name, s.address, s.city, s.country, s.email, s.iec],
  );
}

/** Connect using DATABASE_URL and run migrations. Throws MissingDatabaseUrlError if unset. */
export async function connectDb(databaseUrl: string | null, opts: { verifyCert?: boolean } = {}): Promise<Db> {
  if (!databaseUrl) throw new MissingDatabaseUrlError();
  const db = Db.fromPool(createPool(databaseUrl, opts) as unknown as PoolLike);
  // Neon's free tier suspends idle databases; the first connection after a pause can time out.
  for (let attempt = 1; ; attempt++) {
    try {
      await migrate(db);
      return db;
    } catch (err) {
      if (attempt >= 4) {
        await db.close().catch(() => {});
        throw err;
      }
      console.warn(`[fte] Postgres not reachable yet (attempt ${attempt}/4), retrying in ${attempt * 2}s…`);
      await new Promise((r) => setTimeout(r, attempt * 2000));
    }
  }
}

export const nowIso = () => new Date().toISOString();
