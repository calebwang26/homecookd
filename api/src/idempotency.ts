// A phone's retry of a write (SYSTEM-DESIGN, "Moving data"). The key is claimed in the same transaction as the work, so a failed try frees it, a second
// try at the same moment waits for the first to commit, and a finished one is answered from what it made. idempotency_keys holds ids only, never a body.
import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { tx } from "./db.js";
import { ApiError } from "./errors.js";

const KEY = /^[A-Za-z0-9_-]{8,128}$/;

/** The Idempotency-Key header. A route that creates what someone wrote requires one. */
export function idempotencyKey(req: FastifyRequest, required: boolean): string | null {
  const given = req.headers["idempotency-key"];
  if (given === undefined) {
    if (required) throw new ApiError(400, "idempotency_key_required");
    return null;
  }
  if (typeof given !== "string" || !KEY.test(given)) throw new ApiError(400, "bad_idempotency_key");
  return given;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    return `{${entries
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** What "the same request" means: the same key with a different hash is refused. */
export const requestHash = (parts: unknown) => createHash("sha256").update(stable(parts)).digest("hex");

export type Once = { scope: string; key: string | null; route: string; hash: string; statusCode?: number };

/**
 * Runs `work` once per key, all-or-nothing with the claim, and returns what it made (a row id, or ids as JSON). The caller builds its answer from that, so a
 * replay reads today's row. The same key on another route or with another body is a 409.
 */
export async function once(o: Once, work: (c: PoolClient) => Promise<string>): Promise<{ resourceId: string; replayed: boolean }> {
  return await tx(async (c) => {
    if (o.key === null) return { resourceId: await work(c), replayed: false };
    const claimed = await c.query(
      `insert into idempotency_keys (scope, key, route, request_hash) values ($1, $2, $3, $4)
       on conflict (scope, key) do nothing returning key`,
      [o.scope, o.key, o.route, o.hash],
    );
    if (!claimed.rowCount) {
      const { rows } = await c.query(`select route, request_hash, resource_id from idempotency_keys where scope = $1 and key = $2`, [o.scope, o.key]);
      const first = rows[0];
      if (!first || first.route !== o.route || first.request_hash !== o.hash || !first.resource_id) throw new ApiError(409, "idempotency_conflict");
      return { resourceId: first.resource_id as string, replayed: true };
    }
    const resourceId = await work(c);
    await c.query(`update idempotency_keys set resource_id = $3, status_code = $4 where scope = $1 and key = $2`, [
      o.scope,
      o.key,
      resourceId,
      o.statusCode ?? 200,
    ]);
    return { resourceId, replayed: false };
  });
}
