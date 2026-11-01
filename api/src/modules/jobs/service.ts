// What a family sees of its video jobs. The wire shape is the app's LiveJob (convex.ts), so its screens don't change.
import type { Signed } from "../../auth.js";
import { type JobRow, recentJobs } from "./data.js";

const FINISHED = new Set(["done", "failed"]);
const CANCELLED = "Cancelled."; // convex/jobs.ts says the same
/** A job untouched for this long has lost its phone or worker, so it stops holding every phone at the fast rate. */
const STALE_MS = 2 * 3_600_000;

export type LiveJob = {
  _id: string;
  _creationTime: number;
  uploadPath: string;
  source: "phone" | "glasses";
  stage: string;
  progress: number;
  error?: string;
  recipeId?: string;
  title?: string;
};

export function toLiveJob(row: JobRow): LiveJob {
  // The cook's stop is final from the moment she asks, even before a worker has acknowledged it.
  const stopped = row.cancelled_at !== null && !FINISHED.has(row.stage);
  return {
    _id: row.id,
    _creationTime: row.created_at.getTime(),
    uploadPath: row.upload_key,
    source: row.source,
    stage: stopped ? "failed" : row.stage,
    progress: stopped ? 0 : row.progress,
    ...(stopped ? { error: row.error ?? CANCELLED } : row.error === null ? {} : { error: row.error }),
    ...(row.recipe_id === null ? {} : { recipeId: row.recipe_id }),
    ...(row.title === null ? {} : { title: row.title }),
  };
}

/** The newest 20, as jobs.forFamily does. `active` says something here may still move, so a phone should look again soon. */
export async function liveJobs(signed: Signed, now = Date.now()): Promise<{ data: LiveJob[]; active: boolean }> {
  const rows = await recentJobs(signed.familyId, 20);
  const data = rows.map(toLiveJob);
  const active = rows.some((row, i) => !FINISHED.has(data[i].stage) && now - row.updated_at.getTime() < STALE_MS);
  return { data, active };
}
