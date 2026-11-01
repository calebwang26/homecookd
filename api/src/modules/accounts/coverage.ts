// What SCHEMA.md section 4 says happens to each table when someone deletes their account, as data. A test reads the real schema and fails when a table or a column pointing at
// `people` isn't accounted for here, so a new table can't quietly keep a deleted person's data. Owner: who holds this table's purge. "not merged" means the SQL sits in
// purgeSteps.ts until that area's module exists.
export type Owner = "accounts" | "dish" | "its SQL here for now: recipes and jobs" | "its SQL here for now: community" | "its SQL here for now: messages" | "its SQL here for now: push" | "platform";

export const TABLES: Record<string, { owner: Owner; does: string }> = {
  families: { owner: "accounts", does: "stays; blanked when its last signed-in person goes, and the phone-less people left are deleted (C2)" },
  people: { owner: "accounts", does: "blank tombstone" },
  devices: { owner: "accounts", does: "person null, label null, revoked" },
  identities: { owner: "accounts", does: "deleted, which frees the account" },
  sessions: { owner: "accounts", does: "deleted" },
  invites: { owner: "accounts", does: "naming them: deleted. Sent by them: inviter null, a family invite revoked" },
  join_links: { owner: "accounts", does: "inviter null; the family's link keeps working" },
  move_requests: { owner: "accounts", does: "asking to be them: deleted. Decided by them: decided_by null" },
  signups: { owner: "accounts", does: "a link: row stays nameless; others deleted" },
  account_deletions: { owner: "accounts", does: "stays as proof; lists cleared 60 days after the outside purge (C5)" },
  recipes: { owner: "its SQL here for now: recipes and jobs", does: "theirs deleted at once; folder noted by media_prefix" },
  recordings: { owner: "its SQL here for now: recipes and jobs", does: "theirs deleted after everything saved with them" },
  jobs: { owner: "its SQL here for now: recipes and jobs", does: "theirs deleted, upload_key noted first; unfinished ones cancelled at once" },
  homie_prompts: { owner: "its SQL here for now: recipes and jobs", does: "with the recording" },
  live_events: { owner: "its SQL here for now: recipes and jobs", does: "with the recording" },
  live_windows: { owner: "its SQL here for now: recipes and jobs", does: "with the recording" },
  live_frames: { owner: "its SQL here for now: recipes and jobs", does: "deleted before the recording; frame file marked" },
  cooking_sessions: { owner: "its SQL here for now: recipes and jobs", does: "as the kid: deleted. On their recipes: cascade. As the cook: cook_id null" },
  pending_sends: { owner: "its SQL here for now: recipes and jobs", does: "from them: deleted, hello marked. To them: off recipient_ids" },
  craving_links: { owner: "dish", does: "deleted" },
  dish_asks: { owner: "dish", does: "the kid's and Mom's rules (C3)" },
  dish_ask_translations: { owner: "dish", does: "deleted" },
  dish_answers: { owner: "dish", does: "with the card, or as Mom; clips marked" },
  files: { owner: "accounts", does: "marked; the sweep deletes from S3 (it doesn't reach every bucket yet)" },
  model_calls: { owner: "platform", does: "stays for cost history; its ids go null through the FKs" },
  daily_spend: { owner: "platform", does: "nothing: no person in it" },
  dinners: { owner: "its SQL here for now: community", does: "they host: deleted. Around their recipe: cancelled, recipe_id null" },
  dinner_invite_opens: { owner: "its SQL here for now: community", does: "with the dinner" },
  dinner_requests: { owner: "its SQL here for now: community", does: "with the dinner, and their own asks" },
  swap_requests: { owner: "its SQL here for now: community", does: "they asked, or either recipe is theirs: deleted" },
  reports: { owner: "its SQL here for now: community", does: "reporter_person_id null; the family's hide stays" },
  blocks: { owner: "its SQL here for now: community", does: "label becomes 'A family' where their family is blocked" },
  threads: { owner: "its SQL here for now: messages", does: "their pairs stay, pointing at the tombstone (C1)" },
  thread_reads: { owner: "its SQL here for now: messages", does: "theirs, and any on their pairs" },
  messages: { owner: "its SQL here for now: messages", does: "what they sent goes; what others sent stays (C1)" },
  recipe_notes: { owner: "its SQL here for now: messages", does: "answered by them: deleted. Asked by them: asked_by and question null" },
  questions: { owner: "its SQL here for now: messages", does: "they asked, or on their recipes: deleted. Their answer to another's: taken off" },
  shares: { owner: "its SQL here for now: messages", does: "sender null" },
  favorites: { owner: "its SQL here for now: messages", does: "deleted" },
  recipe_events: { owner: "its SQL here for now: messages", does: "theirs deleted; cook_id null where it names them" },
  push_tokens: { owner: "its SQL here for now: push", does: "deleted at once" },
  push_log: { owner: "its SQL here for now: push", does: "deleted" },
  rate_hits: { owner: "platform", does: "nothing: an HMAC only, pruned after 2 days" },
  idempotency_keys: { owner: "platform", does: "rows with their id as scope deleted" },
  outbox: { owner: "platform", does: "nothing: ids only, cleared in days" },
  lander_events: { owner: "platform", does: "nothing: nothing about a person" },
  sync_copies: { owner: "platform", does: "nothing: no person in it. Goes with the sync" },
  sync_state: { owner: "platform", does: "nothing: no person in it. Goes with the sync" },
  sync_issues: { owner: "platform", does: "nothing: ids and reasons only. Goes with the sync" },
  sync_deleted: { owner: "platform", does: "stays until the sync goes: it's what stops the copy bringing a deleted person back" },
  sync_recipe_seen: { owner: "platform", does: "nothing: ids only. Goes with the sync" },
};

/**
 * Every column with a foreign key to `people` that may still name a deleted person after the purge, and why. Any other such column must end up empty for them, and a test checks it
 * with real rows. `account_deletions.person_id` is the proof. `threads` is C1. `files.owner_person_id` stays until the sweep removes the row a week after S3's delete.
 */
export const MAY_STILL_NAME_THEM = ["account_deletions.person_id", "threads.a_person_id", "threads.b_person_id", "files.owner_person_id"];
