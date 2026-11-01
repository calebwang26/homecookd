// Reading a family's recordings and who's cooking. No writes here: homie is off, and nothing films through this api yet (docs/build/JOBS-MIGRATION.md, "Deferred").
import * as Sentry from "@sentry/node";
import type { Signed } from "../../auth.js";
import { db } from "../../db.js";
import { notFound } from "../../errors.js";
import { objectStore } from "../../storage.js";
import { namesOf } from "../people/reads.js";
import { mediaUrl } from "../recipes/media.js";
import * as data from "./data.js";

const LOG_LIMIT = 2000;
const VIDEOS_READ = 50;
const VIDEOS_SHOWN = 10;
const COOKING_READ = 50;
/** How long after "I'm done" a glasses recording shows as "the laptop is preparing it" before it's dropped. */
const PREPARING_MS = 2 * 60 * 60 * 1000;

const ms = (at: Date | null) => at?.getTime() ?? undefined;

export const recordingView = (r: data.RecordingRow) => ({
  _id: r.id,
  _creationTime: r.created_at.getTime(),
  familyId: r.family_id,
  cookId: r.cook_id,
  forKidId: r.for_kid_ids.length === 1 ? r.for_kid_ids[0] : undefined,
  forKidIds: r.for_kid_ids.length ? r.for_kid_ids : undefined,
  dish: r.dish ?? undefined,
  language: r.language,
  source: r.source,
  status: r.status,
  startedAt: ms(r.started_at),
  endedAt: ms(r.ended_at),
  videoStartedAt: ms(r.video_started_at),
  memoriesOptIn: r.memories_opt_in ?? undefined,
  jobId: r.job_id ?? undefined,
  videoUrl: r.video_key ? mediaUrl(r.video_key) : undefined,
  updatedAt: r.updated_at.getTime(),
});

const ownFamily = async (signed: Signed, id: string) => {
  const row = await data.recordingById(db(), id);
  return row && row.family_id === signed.familyId ? row : null;
};

/** live.recording. Null for a missing recording and for another family's: they read the same. */
export async function readRecording(signed: Signed, id: string) {
  const row = await ownFamily(signed, id);
  return row ? recordingView(row) : null;
}

/** liveEvents.forRecording */
export async function readLiveLog(signed: Signed, id: string) {
  if (!(await ownFamily(signed, id))) return null;
  const [events, windows] = await Promise.all([data.liveEvents(db(), id, LOG_LIMIT), data.windowCounts(db(), id)]);
  return {
    events: events.map((e) => ({ at: e.at_ms, kind: e.kind, title: e.title, text: e.text, saidAs: e.said_as ?? undefined })),
    windows,
  };
}

/** liveEvents.frame: what the glasses see now, by a short link, or null. A link that can't be made reads as no frame, and goes to Sentry. */
export async function readLiveFrame(signed: Signed, id: string) {
  if (!(await ownFamily(signed, id))) return null;
  const row = await data.newestFrame(db(), id);
  if (!row) return null;
  try {
    return { url: await objectStore().presignGet(row.frame_key), at: row.at.getTime() };
  } catch (error) {
    Sentry.captureException(error);
    return null;
  }
}

/** glasses.videos: the ones the laptop saved, and ones that ended in the last 2 h that it's still building. */
export async function readGlassesVideos(signed: Signed) {
  const rows = await data.familyRecordings(db(), signed.familyId, VIDEOS_READ);
  const now = Date.now();
  return rows
    .filter((r) => r.source === "glasses" && (r.video_key || (r.status === "ended" && !r.job_id && now - r.updated_at.getTime() < PREPARING_MS)))
    .slice(0, VIDEOS_SHOWN)
    .map((r) => ({
      recordingId: r.id,
      videoUrl: r.video_key ? mediaUrl(r.video_key) : undefined,
      dish: r.dish ?? undefined,
      at: (r.ended_at ?? r.updated_at).getTime(),
    }));
}

/** cooking.current */
export async function readCooking(signed: Signed) {
  const rows = await data.openCooking(db(), signed.familyId, COOKING_READ);
  const names = await namesOf(db(), rows.map((r) => r.kid_id));
  return rows.map((r) => ({
    kidId: r.kid_id,
    kidName: names.get(r.kid_id) ?? "",
    recipeId: r.recipe_id,
    recipeTitle: r.recipe_title,
    stepOrder: r.step_order,
    stepCount: r.step_count,
    updatedAt: r.updated_at.getTime(),
  }));
}

export async function getOr404<T>(found: Promise<T | null>): Promise<T> {
  const value = await found;
  if (value === null) throw notFound();
  return value;
}
