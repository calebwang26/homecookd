// Turning work away fast when the api is overloaded (AWS-MIGRATION.md, "A production gate: overload"). The Nov 2 load test showed requests waiting on the CPU before
// they ever wait for the pool: 1,500 at once on a 0.25 vCPU task all answered, the slowest after 13 s, and none got the pool's 503. So this looks at both, before a
// request does any work: how late the event loop is running, and how many requests already wait for a database connection. Over either bound, the request gets the
// same 503 and retry-after as a full pool, and the same "too busy to answer" line the api-busy alarm and the scale-out alarm count. /health and /ready are never turned
// away (the load balancer's own check is on health.ts's thread). OVERLOAD_SHED=on turns it on; unset is today's behavior.
import { performance } from "node:perf_hooks";
import { isLockWait, isPoolWait } from "./db.js";

export class Overloaded extends Error {
  override name = "Overloaded";
  constructor(readonly reason: "busy" | "lag" | "pool") {
    super(`overloaded: ${reason}`);
  }
}

/** A lock or the pool gave up, or this turned the request away: nothing was written, and the phone may simply try again. */
export const isBusy = (error: unknown) => isLockWait(error) || isPoolWait(error) || error instanceof Overloaded;

export type Bounds = { maxBusy: number; maxLagMs: number; maxPoolWaiting: number };

const positive = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * Null when off. Busy is the share of the last second the event loop spent working: under a burst it sits near 1, and the wait is before a request is even read, so
 * neither lag nor the pool shows it (the Nov 2 rerun: 1,500 at once, nothing turned away on those two). 0.98 leaves a loaded but coping task alone: 50 a second ran it
 * at about 0.8. 500 ms of lag is well past what that load cost (p99 285 ms at the load balancer). 50 requests waiting on 10 connections is a second's wait at 200 ms a
 * query: a slow database, or something holding rows.
 */
export function bounds(env: NodeJS.ProcessEnv = process.env): Bounds | null {
  if (env.OVERLOAD_SHED !== "on") return null;
  const busy = Number(env.OVERLOAD_MAX_BUSY);
  return {
    maxBusy: Number.isFinite(busy) && busy > 0 && busy <= 1 ? busy : 0.98,
    maxLagMs: positive(env.OVERLOAD_MAX_LAG_MS, 500),
    maxPoolWaiting: positive(env.OVERLOAD_MAX_POOL_WAITING, 50),
  };
}

export const TICK_MS = 50;

/**
 * How late the event loop is running. A timer meant to run every TICK_MS that hasn't run yet counts too: a loop busy for seconds has no chance to run it, and the
 * requests it's busy with are the ones to turn away.
 */
export function lagMeter(now: () => number = () => performance.now()): { lagMs: () => number; stop: () => void } {
  let last = now();
  let lag = 0;
  const timer = setInterval(() => {
    const t = now();
    lag = Math.max(0, t - last - TICK_MS);
    last = t;
  }, TICK_MS);
  timer.unref();
  return { lagMs: () => Math.max(lag, now() - last - TICK_MS), stop: () => clearInterval(timer) };
}

export const BUSY_WINDOW_MS = 1_000;

type Utilization = ReturnType<typeof performance.eventLoopUtilization>;

/** The event loop's utilization over the last whole window (Node's eventLoopUtilization): 0 idle, 1 never idle. */
export function busyMeter(sample: (from?: Utilization) => Utilization = (from) => performance.eventLoopUtilization(from)): { busy: () => number; stop: () => void } {
  let start = sample();
  let busy = 0;
  const timer = setInterval(() => {
    const now = sample();
    busy = sample(start).utilization;
    start = now;
  }, BUSY_WINDOW_MS);
  timer.unref();
  return { busy: () => busy, stop: () => clearInterval(timer) };
}

const UNGUARDED = new Set(["/health", "/ready"]);

/** The onRequest check. Throws, so each route's own error handler answers in its own shape. */
export function shedder(b: Bounds, busy: () => number, lagMs: () => number, poolWaiting: () => number) {
  return async (req: { routeOptions: { url?: string } }) => {
    if (UNGUARDED.has(req.routeOptions.url ?? "")) return;
    if (busy() > b.maxBusy) throw new Overloaded("busy");
    if (lagMs() > b.maxLagMs) throw new Overloaded("lag");
    if (poolWaiting() > b.maxPoolWaiting) throw new Overloaded("pool");
  };
}
