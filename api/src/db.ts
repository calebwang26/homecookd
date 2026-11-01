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
  pool ??= new pg.Pool(config());
  return pool;
}
