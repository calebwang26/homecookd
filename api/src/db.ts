// The Postgres pool. On AWS the host and login come from the task (infra/modules/env/services.tf); locally, DATABASE_URL.
import pg from "pg";

function config(): pg.PoolConfig {
  const base = { max: 10, connectionTimeoutMillis: 5_000, statement_timeout: 10_000, idleTimeoutMillis: 30_000 };
  if (process.env.DATABASE_URL) return { ...base, connectionString: process.env.DATABASE_URL };
  if (!process.env.DB_HOST || !process.env.DB_CREDENTIALS) throw new Error("No database settings");
  const { username, password } = JSON.parse(process.env.DB_CREDENTIALS);
  return { ...base, host: process.env.DB_HOST, database: "homecookd", user: username, password, ssl: { rejectUnauthorized: true } };
}

let pool: pg.Pool | undefined;

export function db(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool(config());
    // A restart or failover drops idle connections. With no listener that error ends the whole process, on every task at once.
    pool.on("error", (error) => {
      console.error(JSON.stringify({ level: "warn", msg: "idle database connection lost", code: (error as { code?: string }).code }));
    });
  }
  return pool;
}

/** What data access needs: the pool, or a client inside tx(). */
export type Queryable = Pick<pg.Pool, "query">;

/** Every connection stayed busy past the wait. No connection was got, so nothing was written and a retry can't double anything. */
export const isPoolWait = (error: unknown) =>
  error instanceof Error && error.message === "timeout exceeded when trying to connect";

const SERIALIZATION_FAILURE = "40001";
const DEADLOCK = "40P01";

/**
 * All-or-nothing work, retried on a conflict (SYSTEM-DESIGN.md: Convex did this for us, and Postgres won't). `fn` may run more than
 * once, so it holds only database work. Never call an outside service inside one: it would hold a connection while it waits.
 */
export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    const client = await db().connect();
    try {
      await client.query("begin");
      const out = await fn(client);
      await client.query("commit");
      return out;
    } catch (error) {
      await client.query("rollback").catch(() => {});
      const code = (error as { code?: string }).code;
      if (attempt >= 3 || (code !== SERIALIZATION_FAILURE && code !== DEADLOCK)) throw error;
    } finally {
      client.release();
    }
  }
}
