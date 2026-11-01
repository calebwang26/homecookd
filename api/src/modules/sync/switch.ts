// The one switch for the temporary sync of families, people and recipes into Postgres (docs/build/SYNC-MIGRATION.md).
//
// KEEP THIS OFF until /privacy lists AWS. Running it copies names, emails, places and family stories into AWS, and /privacy's "Where it's
// kept" doesn't name AWS yet (AWS-MIGRATION.md, "Waiting on Apple's approval of 1.0"). Turning it on also needs Caleb's OK, because it
// copies production data, and it needs the Convex route deployed.
//
//   off (the default, and anything not spelled exactly): reads nothing, writes nothing.
//   on: copies changes and carries deletions.
//   deletions: copies nothing new but still carries deletions. Use this to pause: once copies hold real rows, `off` would let a deleted
//              person's copy stay until someone empties it, so `off` raises an alert in that state.
export type SyncMode = "off" | "on" | "deletions";

export function syncMode(env: NodeJS.ProcessEnv = process.env): SyncMode {
  const value = env.SYNC_MODE;
  return value === "on" || value === "deletions" ? value : "off";
}
