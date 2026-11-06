// Which messages are questions, who can answer each, and who did. Answered is derived from the messages, with no stored flag, so it can't drift from them.
import { db } from "../../db.js";
import type { Member } from "../people/family.js";
import * as data from "./data.js";
import type { MessageRow, ThreadRow } from "./data.js";

export type Target = { asker: string; answerer: string | null };

/**
 * - Circle: every `question`; any cook other than the asker answers it.
 * - Pair: a `question`, or a kid's `step` message with words (a step question), is for the other person; only that person answers it.
 * Roles come from everyone who was ever in the family, so removing someone never reopens a question they asked or answered.
 */
export function questionTargets(everyone: Member[], rows: MessageRow[], threads: Map<string, ThreadRow>): Map<string, Target> {
  const out = new Map<string, Target>();
  const kids = new Set(everyone.filter((p) => p.role === "kid").map((p) => p.id));
  for (const m of rows) {
    const t = threads.get(m.thread_id);
    if (!t) continue;
    if (t.kind === "circle") {
      if (m.kind === "question") out.set(m.id, { asker: m.sender_id, answerer: null });
    } else if (m.kind === "question" || (m.kind === "step" && m.body && kids.has(m.sender_id))) {
      const other = t.a_person_id === m.sender_id ? t.b_person_id : t.b_person_id === m.sender_id ? t.a_person_id : null;
      if (other) out.set(m.id, { asker: m.sender_id, answerer: other });
    }
  }
  return out;
}

export function canAnswer(everyone: Member[], target: Target, who: string): boolean {
  if (who === target.asker) return false;
  if (target.answerer) return who === target.answerer;
  return everyone.some((p) => p.id === who && p.role === "cook");
}

/** When Supabase's messages.reply_to arrived. created_at is always server-set, so no new message can fall before it. */
const LEGACY_STEP_BEFORE = Date.parse("2026-10-16T08:35:22Z");

export type Answer = { by: string; at: string };

/** Who answered each question first: the earliest reply from someone who can answer it. */
export async function answersFor(familyId: string, everyone: Member[], questions: MessageRow[], known?: Map<string, ThreadRow>): Promise<Map<string, Answer>> {
  const out = new Map<string, Answer>();
  const candidates = questions.filter((m) => m.kind === "question" || (m.kind === "step" && m.body));
  if (candidates.length === 0) return out;
  const threads =
    known ??
    new Map((await data.threadsByIds(db(), [...new Set(candidates.map((m) => m.thread_id))], familyId)).map((t) => [t.id, t]));
  const targets = questionTargets(everyone, candidates, threads);
  if (targets.size === 0) return out;
  for (const r of await data.repliesTo(db(), [...targets.keys()], familyId)) {
    if (out.has(r.reply_to) || !canAnswer(everyone, targets.get(r.reply_to)!, r.sender_id)) continue;
    out.set(r.reply_to, { by: r.sender_id, at: r.created_at });
  }
  // A 1:1 step question sent before reply_to existed is also answered by the next message the person asked sends in that chat. Only a handful exist.
  const steps = candidates.filter((m) => m.kind === "step" && targets.get(m.id)?.answerer && Date.parse(m.created_at) < LEGACY_STEP_BEFORE);
  for (const q of steps) {
    const next = await data.nextFrom(db(), q, targets.get(q.id)!.answerer!);
    const linked = out.get(q.id);
    if (next && (!linked || Date.parse(next.created_at) < Date.parse(linked.at))) out.set(q.id, { by: next.sender_id, at: next.created_at });
  }
  return out;
}
