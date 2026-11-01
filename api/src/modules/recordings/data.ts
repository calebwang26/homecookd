// The SQL for recordings, what the glasses saw, and who's cooking. With homie off, these tables get only what reads and deletion need (docs/build/JOBS-MIGRATION.md,
// "Deferred"). Every query, and the index behind it:
//
//   Query                                 Index                            Limit
//   one recording, and a job naming it    recordings primary key           1
//   her family's glasses videos           recordings_family_recent         50, as glasses.videos
//   what the glasses saw                  live_events_recording            2000, as liveEvents.forRecording
//   windows analysed and missed           live_windows_recording           one recording's
//   the newest frame                      live_frames primary key          1
//   who's cooking                         cooking_sessions_family_recent   50, as cooking.current
//   a person's recordings (the purge)     recordings_cook_started          the purge's batch
//   a kid's cooking rows (the purge)      cooking_sessions_kid_recent      the purge's batch
//   a cook's cooking rows (the purge)     cooking_sessions_cook_open       the purge's batch
import type { Queryable } from "../../db.js";

export type RecordingRow = {
  id: string;
  family_id: string;
  cook_id: string;
  for_kid_ids: string[];
  dish: string | null;
  language: string;
  source: "phone" | "glasses";
  status: "intro" | "recording" | "wrapping_up" | "ended" | "abandoned";
  started_at: Date | null;
  ended_at: Date | null;
  video_started_at: Date | null;
  memories_opt_in: boolean | null;
  job_id: string | null;
  video_key: string | null;
  cover_key: string | null;
  created_at: Date;
  updated_at: Date;
};

const RECORDING = `id, family_id, cook_id, for_kid_ids, dish, language, source, status, started_at, ended_at, video_started_at, memories_opt_in, job_id, video_key, cover_key,
  created_at, updated_at`;

export async function recordingById(q: Queryable, id: string): Promise<RecordingRow | null> {
  const { rows } = await q.query(`select ${RECORDING} from recordings where id = $1`, [id]);
  return rows[0] ?? null;
}

/** The attach guard: a job can name only the cook's own recording. */
export async function lockOwnRecording(c: Queryable, id: string, familyId: string, cookId: string): Promise<RecordingRow | null> {
  const { rows } = await c.query(`select ${RECORDING} from recordings where id = $1 and family_id = $2 and cook_id = $3 for update`, [id, familyId, cookId]);
  return rows[0] ?? null;
}

export async function noteRecordingJob(c: Queryable, recordingId: string, jobId: string): Promise<void> {
  await c.query(`update recordings set job_id = $2, updated_at = now() where id = $1`, [recordingId, jobId]);
}

export async function familyRecordings(q: Queryable, familyId: string, limit: number): Promise<RecordingRow[]> {
  const { rows } = await q.query(`select ${RECORDING} from recordings where family_id = $1 order by created_at desc limit $2`, [familyId, limit]);
  return rows;
}

export type LiveEventRow = { kind: string; title: string; text: string; said_as: string | null; at_ms: number };

/** Oldest first, on the wall clock. */
export async function liveEvents(q: Queryable, recordingId: string, limit: number): Promise<LiveEventRow[]> {
  const { rows } = await q.query(
    `select kind, title, text, said_as, extract(epoch from session_started_at) * 1000 + at_s * 1000 as at_ms
       from live_events where recording_id = $1 order by session_started_at, at_s limit $2`,
    [recordingId, limit],
  );
  return rows.map((row) => ({ ...row, at_ms: Number(row.at_ms) }));
}

export async function windowCounts(q: Queryable, recordingId: string): Promise<{ analysed: number; missed: number }> {
  const { rows } = await q.query(
    `select count(*) filter (where ok)::int as analysed, count(*) filter (where not ok)::int as missed from live_windows where recording_id = $1`,
    [recordingId],
  );
  return rows[0];
}

export async function newestFrame(q: Queryable, recordingId: string): Promise<{ frame_key: string; at: Date } | null> {
  const { rows } = await q.query(`select frame_key, at from live_frames where recording_id = $1`, [recordingId]);
  return rows[0] ?? null;
}

export type CookingRow = { kid_id: string; recipe_id: string; recipe_title: string; step_order: number; step_count: number; updated_at: Date };

/** Open rows only, for a dish in `recipes`: a library dish from Supabase's POST /cooking has no recipe row, and moves with Messages (JOBS-MIGRATION.md). */
export async function openCooking(q: Queryable, familyId: string, limit: number): Promise<CookingRow[]> {
  const { rows } = await q.query(
    `select s.kid_id, s.recipe_id, r.title as recipe_title, s.step_order, r.step_count, s.updated_at
       from cooking_sessions s
       join recipes r on r.id = s.recipe_id
      where s.family_id = $1 and s.ended_at is null
      order by s.updated_at desc limit $2`,
    [familyId, limit],
  );
  return rows;
}

// ---------------------------------------------------------------------------------------------
// The purge (jobs/account.ts)

export async function abandonRecordingsOf(c: Queryable, personId: string): Promise<void> {
  await c.query(`update recordings set status = 'abandoned', updated_at = now() where cook_id = $1 and status <> 'abandoned'`, [personId]);
}

export async function recordingsOf(q: Queryable, personId: string, limit: number): Promise<RecordingRow[]> {
  const { rows } = await q.query(`select ${RECORDING} from recordings where cook_id = $1 limit $2`, [personId, limit]);
  return rows;
}

/** A frame holds a file key, so it never cascades: it goes first, and its key comes back to be marked. */
export async function deleteFrame(c: Queryable, recordingId: string): Promise<string | null> {
  const { rows } = await c.query(`delete from live_frames where recording_id = $1 returning frame_key`, [recordingId]);
  return rows[0]?.frame_key ?? null;
}

/** homie_prompts, live_events and live_windows cascade from it. */
export async function deleteRecording(c: Queryable, recordingId: string): Promise<void> {
  await c.query(`delete from recordings where id = $1`, [recordingId]);
}

export async function deleteCookingOfKid(q: Queryable, personId: string, limit: number): Promise<number> {
  const { rowCount } = await q.query(`delete from cooking_sessions where id in (select id from cooking_sessions where kid_id = $1 limit $2)`, [personId, limit]);
  return rowCount ?? 0;
}

export async function forgetCookOnCooking(q: Queryable, personId: string, limit: number): Promise<number> {
  const { rowCount } = await q.query(`update cooking_sessions set cook_id = null where id in (select id from cooking_sessions where cook_id = $1 limit $2)`, [personId, limit]);
  return rowCount ?? 0;
}
