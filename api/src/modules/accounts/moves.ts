// Moving to a new phone. Dad lost his phone and joined again through a family link, so his new phone has a key with no person. It asks to be Dad; someone else settled,
// on their own phone, lets him in, which makes the new phone his and signs his other phones out. A request lives 7 days; "expired" is computed, never stored.
import { db, tx } from "../../db.js";
import * as data from "./data.js";
import { extId, toProfile, type MoveRow, type Person } from "./data.js";
import { type Ctx, onOwnPhone, profileIn, requireMe, settledIds } from "./proofs.js";
import { ALREADY_HANDLED, DAY_MS, limit, MOVE_DAYS, MOVE_EXPIRED, NOT_SETTLED, refuse, UUID, type Body } from "./values.js";

const ASKED_MAX = 3;

const moveStatus = (r: MoveRow) => (r.status === "pending" && r.created_at.getTime() <= Date.now() - MOVE_DAYS * DAY_MS ? ("expired" as const) : r.status);

function requireOwnPhone(ctx: Ctx): Person {
  const me = requireMe(ctx);
  if (!onOwnPhone(ctx)) throw refuse(403, "Only someone on their own phone can let people in.");
  return me;
}

async function requireAnswerer(ctx: Ctx): Promise<Person> {
  const me = requireOwnPhone(ctx);
  if (!(await settledIds(ctx, [me.id])).has(me.id)) throw refuse(403, NOT_SETTLED);
  return me;
}

/** The asks this caller can answer: pending, unexpired, in my family, not to be me, for someone still here, from a phone still waiting. Newest first. */
export async function answerableMoves(ctx: Ctx): Promise<MoveRow[]> {
  if (!onOwnPhone(ctx) || !(await settledIds(ctx, [ctx.me!.id])).has(ctx.me!.id)) return [];
  const rows = (await data.pendingMovesOf(db(), ctx.family.id, ctx.me!.id, MOVE_DAYS)).filter((r) => ctx.profiles.some((p) => p.id === r.person_id));
  if (!rows.length) return rows;
  const waiting = await data.waitingDevices(db(), [...new Set(rows.map((r) => r.device_id))]);
  return rows.filter((r) => waiting.has(r.device_id));
}

async function moveIn(ctx: Ctx, id: string): Promise<MoveRow> {
  const row = UUID.test(id) ? await data.moveById(db(), id.toLowerCase(), ctx.family.id) : null;
  if (!row) throw refuse(404, "No such request.");
  return row;
}

/** 409 once approved or declined, 410 once expired. */
function assertOpen(r: MoveRow): void {
  const status = moveStatus(r);
  if (status === "expired") throw refuse(410, MOVE_EXPIRED);
  if (status !== "pending") throw refuse(409, ALREADY_HANDLED);
}

const asked = (ctx: Ctx, r: MoveRow) => ({
  id: r.id,
  profile_id: extId(ctx.profiles.find((p) => p.id === r.person_id) ?? { id: r.person_id, supabase_id: null }),
  status: "pending" as const,
  created_at: r.created_at.toISOString(),
});

/** One pending ask per phone: the same person again returns it; someone else replaces it; an expired one is declined and a new one made. */
export async function askToMove(ctx: Ctx, b: Body) {
  const device = ctx.device;
  if (!device || device.via !== "invite" || device.person_id) throw refuse(400, "Only a phone that just joined can ask to move in.");
  // TODO(caleb): anyone still in the family can be asked for, phone-less faces and people only invited included (approval is the check). Supabase's own TODO, kept.
  const target = profileIn(ctx, b.profile_id, "profile_id");
  await limit("move-requests", ctx.family.id, 30, 60, "That's a lot of asks for one hour. Try again later.");
  return tx(async (c) => {
    for (const r of await data.pendingMovesOfDevice(c, device.id)) {
      if (moveStatus(r) === "pending" && r.person_id === target.id) return asked(ctx, r); // a repeat tap
      await data.closeMoveAs(c, r.id); // expired, or for someone else: this ask replaces it
    }
    const made = await data.insertMove(c, { familyId: ctx.family.id, personId: target.id, deviceId: device.id });
    if (made) return asked(ctx, made);
    // Another tap made one a moment ago (one pending per phone): if it's for the same person, it stands.
    const won = (await data.pendingMovesOfDevice(c, device.id))[0];
    if (won?.person_id === target.id) return asked(ctx, won);
    throw refuse(409, "Please try again.");
  });
}

/** This phone's latest ask, or null. `asked`: while pending, up to 3 people who can let them in. `let_in_by`: who approved it. */
export async function myMove(ctx: Ctx) {
  if (!ctx.device) return null;
  const r = await data.latestMoveOfDevice(db(), ctx.device.id);
  if (!r) return null;
  const status = moveStatus(r);
  let names: string[] = [];
  if (status === "pending") {
    const can = ctx.profiles.filter((p) => p.id !== r.person_id && ctx.phones.has(p.id));
    const settled = await settledIds(ctx, can.map((p) => p.id));
    names = can.filter((p) => settled.has(p.id)).slice(0, ASKED_MAX).map((p) => p.name);
  }
  const by = status === "approved" ? ctx.everyone.find((p) => p.id === r.decided_by) : undefined;
  const person = ctx.everyone.find((p) => p.id === r.person_id);
  return { id: r.id, profile_id: person ? extId(person) : r.person_id, status, asked: names, let_in_by: by?.name ?? null };
}

export async function movesICanAnswer(ctx: Ctx) {
  const rows = await answerableMoves(ctx);
  const byId = new Map(ctx.profiles.map((p) => [p.id, p]));
  return rows.map((r) => ({ id: r.id, profile: toProfile(byId.get(r.person_id)!), created_at: r.created_at.toISOString() }));
}

/** After a conditional update that changed nothing: says why. */
async function explainDecide(ctx: Ctx, id: string): Promise<never> {
  assertOpen(await moveIn(ctx, id));
  throw refuse(409, ALREADY_HANDLED);
}

/** Let them in: the asking phone becomes theirs and their other phones and sessions end, all at once. First answer wins. No circle note. */
export async function approveMove(ctx: Ctx, id: string) {
  const me = await requireAnswerer(ctx);
  const r = await moveIn(ctx, id);
  if (r.person_id === me.id) throw refuse(400, "You can't let yourself in.");
  assertOpen(r);
  const target = ctx.profiles.find((p) => p.id === r.person_id);
  // Each of these commits before it refuses, so the ask is closed however the answer reads.
  const outcome = await tx(async (c) => {
    if (!target) return (await data.decideMove(c, r.id, "declined", me.id, MOVE_DAYS)) ? ("gone" as const) : ("lost" as const);
    if (!(await data.lockLivePerson(c, target.id))) return (await data.decideMove(c, r.id, "declined", me.id, MOVE_DAYS)) ? ("gone" as const) : ("lost" as const); // left or deleted a moment ago
    if (!(await data.decideMove(c, r.id, "approved", me.id, MOVE_DAYS))) return "lost" as const;
    // Only while it still waits: not signed out, no person yet.
    if (!(await data.claimDevice(c, r.device_id, target.id))) {
      await data.closeMoveAs(c, r.id);
      return "not_waiting" as const;
    }
    await data.signPersonOut(c, target.id, r.device_id);
    await data.revokeInvitesOf(c, target.id);
    return "ok" as const;
  });
  if (outcome === "ok") return { ok: true };
  if (outcome === "gone") throw refuse(409, ALREADY_HANDLED);
  if (outcome === "not_waiting") throw refuse(409, "That phone isn't waiting anymore.");
  return explainDecide(ctx, r.id);
}

/** Say no: pending -> declined. No note. The phone can ask again. */
export async function declineMove(ctx: Ctx, id: string) {
  const me = await requireAnswerer(ctx);
  const r = await moveIn(ctx, id);
  assertOpen(r);
  if (!(await data.decideMove(db(), r.id, "declined", me.id, MOVE_DAYS))) return explainDecide(ctx, r.id);
  return { ok: true };
}
