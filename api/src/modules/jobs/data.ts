// The SQL behind jobs. jobs_family_recent answers the read below; the limit keeps it to a page of rows.
import { db } from "../../db.js";

export type JobRow = {
  id: string;
  upload_key: string;
  source: "phone" | "glasses";
  stage: string;
  progress: number;
  error: string | null;
  recipe_id: string | null;
  title: string | null;
  created_at: Date;
  updated_at: Date;
  cancelled_at: Date | null;
};

export async function recentJobs(familyId: string, limit: number): Promise<JobRow[]> {
  const { rows } = await db().query(
    `select id, upload_key, source, stage, progress, error, recipe_id, title, created_at, updated_at, cancelled_at
       from jobs
      where family_id = $1
      order by created_at desc, id desc
      limit $2`,
    [familyId, limit],
  );
  return rows;
}
