// The accounts area's queue work (scheduled.ts). Every task is safe to repeat. `accounts.sweep` runs from an EventBridge schedule, hourly (not in infra yet: ACCOUNTS-MIGRATION.md).
import { db } from "../../db.js";
import { enqueue } from "../../outbox.js";
import type { Trace } from "../dish/budget.js";
import * as data from "./data.js";
import { clearOldLists, dueOutside, purgeOutside, restartPurges, runPurge } from "./deletion.js";

type Payload = Record<string, unknown>;

const text = (payload: Payload, name: string): string => {
  const value = payload[name];
  if (typeof value !== "string" || !value) throw new Error(`${name} is missing`);
  return value;
};

/** Expired sessions, purges that stopped, outside purges due another try, and C5's old lists. */
export async function accountsSweep(trace: Pick<Trace, "requestId">): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    if ((await data.deleteExpiredSessions(db())) < 500) break;
  }
  await restartPurges(trace.requestId);
  for (const deletionId of await dueOutside()) {
    await enqueue(db(), { queue: "scheduled", payload: { task: "accounts.outside", deletionId }, requestId: trace.requestId });
  }
  await clearOldLists();
}

export const accountTasks: Record<string, (payload: Payload, trace: Trace) => Promise<void>> = {
  "accounts.purge": async (payload, trace) => {
    await runPurge(text(payload, "deletionId"), trace);
  },
  "accounts.outside": async (payload) => {
    await purgeOutside(text(payload, "deletionId"));
  },
  "accounts.sweep": (_payload, trace) => accountsSweep(trace),
};
