// Live check of the two-sided routes against the deployed api, on the TEST family only.
// Dependency-free (Node 20+). Prints only PASS / FAIL lines and a count; exits 1 on any failure.
// Never prints the family code, device keys or invite tokens.
//
//   node supabase/tests/two_sided_live.mjs
//   API_URL=https://<project>.supabase.co/functions/v1/api node supabase/tests/two_sided_live.mjs
//
// It acts as someone in the test family with no phone of their own and no pending invite, and
// gives that person a test key (their "phone") for the run; the key is revoked at the end, which
// frees them again. Letting someone in on a new phone takes a settled member (their first phone
// joined over a day ago): that person is settled when an earlier run gave them a key over a day
// ago. On a first run (not settled yet) it checks the refusal instead and prints a NOTE.
//
// Nobody removes anyone else, so each test person leaves by themselves (from their own phone, or
// as themselves on the test key or the family code when they have none).
// What it leaves behind (no API deletes these): its test people, soft-removed (they show in
// `former_profiles`); in the test family's circle four "<Name> joined." notes; one 1:1 text to a test person; two
// move_requests rows (one approved, one declined), or one declined when not settled yet; and three lander_events rows with app =
// 'two_sided_live' (filter them out of lander numbers). Every key it made is revoked.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const API = (process.env.API_URL || "https://bsudybxsqvtwftsdmwmz.supabase.co/functions/v1/api").replace(/\/+$/, "");
const here = dirname(fileURLToPath(import.meta.url));
const CODE = readFileSync(join(here, "../../docs/build/.test-family-code"), "utf8").trim();
const SIGNED_OUT = "This phone was signed out.";
const KEY_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const tag = Math.random().toString(36).slice(2, 7);

let passed = 0;
let failed = 0;
function check(name, ok, got) {
  if (ok) {
    passed++;
    console.log(`PASS ${name}`);
  } else {
    failed++;
    console.log(`FAIL ${name}${got ? ` (${got})` : ""}`);
  }
  return ok;
}
/** What a failure line may show: the status and the server's human sentence, nothing else. */
const seen = (r) => `got ${r.status}${r.data?.error ? `: ${r.data.error}` : ""}`;

async function call(method, path, { body, raw, type, code, key, me } = {}) {
  const headers = {};
  if (code) headers["x-family-code"] = code;
  if (key) headers["x-device-key"] = key;
  if (me) headers["x-profile-id"] = me;
  let payload = raw;
  if (body !== undefined) payload = JSON.stringify(body);
  if (payload !== undefined) headers["content-type"] = type || "application/json";
  try {
    const res = await fetch(`${API}${path}`, { method, headers, body: payload });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    return { status: res.status, data };
  } catch (e) {
    return { status: 0, data: { error: `network: ${e.message}` } };
  }
}

const made = { keys: [], profiles: [] };
const tokenOf = (invite) => new URL(invite.url).searchParams.get("t");

async function run() {
  // Safety: this must be the test family, never the demo family.
  const fam0 = await call("GET", "/family", { code: CODE });
  if (!check("test family code opens a family", fam0.status === 200, seen(fam0))) return;
  if (!check("it is not the demo family", fam0.data.family.name !== "Our family", "refusing to write to Our family")) return;
  // Someone the server lets us act as: no phone of their own (else 403) and not only invited.
  const free = (p) => !p.locked && !p.invited;
  const me = fam0.data.profiles.find((p) => p.role === "cook" && free(p)) ?? fam0.data.profiles.find(free);
  if (!check("test family has someone free to act as (no phone, not only invited)", !!me)) return;
  check("profiles carry locked", fam0.data.profiles.every((p) => typeof p.locked === "boolean"), seen(fam0));
  const circle = await call("GET", "/circle", { code: CODE });
  const cid = circle.data?.id;
  if (!check("GET /circle", circle.status === 200 && !!cid, seen(circle))) return;
  // Someone added the old way (no invite, no phone): a face any phone can still pick.
  const plainR = await call("POST", "/profiles", { code: CODE, body: { name: `Live Plain ${tag}`, role: "learner" } });
  const plain = plainR.data?.id ? plainR.data : null;
  if (plain) made.profiles.push(plain.id);
  if (!check("POST /profiles (someone added without an invite)", !!plain, seen(plainR))) return;

  // A2: swap the family code for this phone's own key, then use the key.
  const dev = await call("POST", "/devices", { code: CODE, body: { device_label: "Live test" } });
  const keyA = dev.data?.device_key;
  if (keyA) made.keys.push(keyA);
  check("POST /devices returns a 43-character key", dev.status === 200 && KEY_SHAPE.test(keyA ?? ""), seen(dev));
  const famA = await call("GET", "/family", { key: keyA });
  check("GET /family with x-device-key", famA.status === 200 && famA.data.family.id === fam0.data.family.id, seen(famA));
  check("a code-exchange key has no device_profile_id yet", famA.data?.device_profile_id === null, seen(famA));
  check("...and doesn't need a profile (not a family invite)", famA.data?.device_needs_profile === false, seen(famA));
  check("profiles carry invited", famA.data?.profiles?.every((p) => typeof p.invited === "boolean"), seen(famA));
  const junk = await call("GET", "/family", { key: "x".repeat(43) });
  check("unknown key: 401 'This phone was signed out.'", junk.status === 401 && junk.data?.error === SIGNED_OUT, seen(junk));
  const spare = await call("POST", "/devices", { key: keyA, body: {} });
  check("POST /devices with a key: 400 (no spare keys)", spare.status === 400, seen(spare));
  // E1: its first write as a phone-less person makes it their phone; then only it can be them.
  const first = await call("POST", `/threads/${cid}/read`, { key: keyA, me: me.id });
  const famA2 = await call("GET", "/family", { key: keyA });
  check("the key's first write makes it that person's phone",
    first.status === 200 && famA2.data?.device_profile_id === me.id, first.status === 200 ? seen(famA2) : seen(first));
  const meByCode = await call("GET", "/favorites", { code: CODE, me: me.id });
  check("...so the family code can't be them now (403 '… uses their own phone.')",
    meByCode.status === 403 && meByCode.data?.error === `${me.name} uses their own phone.`, seen(meByCode));
  const email = await call("POST", `/profiles/${me.id}/email`, { key: keyA, me: me.id, body: { email: `live-${tag}@example.com` } });
  check("a key can't add an email: 403", email.status === 403, seen(email));

  // A4: invite someone new, peek, accept once.
  const inv1 = await call("POST", "/invites", { key: keyA, me: me.id, body: { name: `Live Test ${tag}`, role: "learner", phone: "+1 555 010 0000" } });
  const invite1 = inv1.data?.invite;
  const invitee = inv1.data?.profile;
  if (invitee) made.profiles.push(invitee.id);
  check("POST /invites (new person)", inv1.status === 200 && !!invite1 && invitee?.invited === true, seen(inv1));
  if (!invite1) return;
  check("invite url is /i?t=<16 base62>&c=<code>",
    /\/i\?t=[0-9A-Za-z]{16}&c=[A-HJ-NP-Z2-9]{6}$/.test(invite1.url) && new URL(invite1.url).searchParams.get("c") === invite1.code);
  check("invite code is 6 letters", /^[A-HJ-NP-Z2-9]{6}$/.test(invite1.code));
  const t1 = tokenOf(invite1);
  const peek1 = await call("POST", "/invites/peek", { body: { token: t1 } });
  check("peek: pending, names the inviter and invitee",
    peek1.status === 200 && peek1.data.status === "pending" && peek1.data.inviter?.name === me.name && peek1.data.invitee?.name === invitee.name,
    seen(peek1));
  check("peek without a key leaves same_family out", peek1.status === 200 && !("same_family" in (peek1.data ?? {})), seen(peek1));
  const peekMine = await call("POST", "/invites/peek", { key: keyA, body: { token: t1 } });
  check("peek with this family's key: same_family true", peekMine.status === 200 && peekMine.data?.same_family === true, seen(peekMine));
  const peekJunk = await call("POST", "/invites/peek", { key: "x".repeat(43), body: { token: t1 } });
  check("peek with an unknown key: same_family false (never 401)", peekJunk.status === 200 && peekJunk.data?.same_family === false, seen(peekJunk));
  const peekCode = await call("POST", "/invites/peek", { body: { code: invite1.code } });
  check("peek by code", peekCode.status === 200 && peekCode.data.status === "pending", seen(peekCode));
  const listed = await call("GET", "/family", { key: keyA });
  const listedInvitee = listed.data?.profiles?.find((p) => p.id === invitee.id);
  check("GET /family shows the invitee as invited", listedInvitee?.invited === true, seen(listed));
  check("...with no phone yet (has_phone false)", listedInvitee?.has_phone === false, seen(listed));

  const acc = await call("POST", "/invites/accept", { body: { token: t1, device_label: "Live test" } });
  const keyB = acc.data?.device_key;
  if (keyB) made.keys.push(keyB);
  check("accept: key for the invited person", acc.status === 200 && KEY_SHAPE.test(keyB ?? "") && acc.data.profile_id === invitee.id, seen(acc));
  const again = await call("POST", "/invites/accept", { body: { token: t1 } });
  check("accept again: 410 used", again.status === 410 && again.data?.status === "used" && again.data?.error === "This invite was already used.", seen(again));
  const peekUsed = await call("POST", "/invites/peek", { body: { token: t1 } });
  check("peek after use: used", peekUsed.data?.status === "used", seen(peekUsed));
  const famB = await call("GET", "/family", { key: keyB });
  const joined = famB.data?.profiles?.find((p) => p.id === invitee.id);
  check("joined person is listed and no longer invited", famB.status === 200 && joined?.invited === false, seen(famB));
  check("...and has a phone now (has_phone true)", joined?.has_phone === true, seen(famB));
  check("their phone's device_profile_id is them", famB.data?.device_profile_id === invitee.id, seen(famB));
  const notes = await call("GET", `/threads/${cid}/messages`, { key: keyA, me: me.id });
  check(`circle has "<Name> joined."`, notes.data?.some?.((m) => m.kind === "system" && m.body === `${invitee.name} joined.`), seen(notes));

  // Two Join taps at once: exactly one gets in.
  const inv3 = await call("POST", "/invites", { key: keyA, me: me.id, body: { name: `Live Third ${tag}`, role: "learner" } });
  if (inv3.data?.profile) made.profiles.push(inv3.data.profile.id);
  if (check("POST /invites (third person)", inv3.status === 200, seen(inv3))) {
    const t3 = tokenOf(inv3.data.invite);
    const both = await Promise.all([1, 2].map(() => call("POST", "/invites/accept", { body: { token: t3, device_label: "Live test" } })));
    for (const r of both) if (r.data?.device_key) made.keys.push(r.data.device_key);
    const codes = both.map((r) => r.status).sort().join(",");
    check("two Joins at once: one 200, one 410 used", codes === "200,410" && both.some((r) => r.data?.status === "used"), codes);
  }

  // Re-invite turns the older link off.
  const inv2 = await call("POST", "/invites", { key: keyA, me: me.id, body: { name: `Live Second ${tag}`, role: "cook" } });
  const second = inv2.data?.profile;
  if (second) made.profiles.push(second.id);
  check("POST /invites (second person)", inv2.status === 200 && !!second, seen(inv2));
  if (!second) return;
  const re = await call("POST", "/invites", { key: keyA, me: me.id, body: { profile_id: second.id } });
  check("POST /invites {profile_id} re-invites", re.status === 200 && re.data?.invite?.profile_id === second.id, seen(re));
  const oldPeek = await call("POST", "/invites/peek", { body: { token: tokenOf(inv2.data.invite) } });
  check("the first link is now revoked", oldPeek.data?.status === "revoked", seen(oldPeek));
  const oldAcc = await call("POST", "/invites/accept", { body: { token: tokenOf(inv2.data.invite) } });
  check("accept a revoked link: 410 turned off",
    oldAcc.status === 410 && oldAcc.data?.status === "revoked" && oldAcc.data?.error === "This invite was turned off.", seen(oldAcc));
  if (re.data?.invite) {
    const newPeek = await call("POST", "/invites/peek", { body: { token: tokenOf(re.data.invite) } });
    check("the new link is pending", newPeek.data?.status === "pending", seen(newPeek));
  }
  const joinedAgain = await call("POST", "/invites", { key: keyA, me: me.id, body: { profile_id: invitee.id } });
  check("can't re-invite someone who joined (409)", joinedAgain.status === 409, seen(joinedAgain));
  const unknown = await call("POST", "/invites/peek", { body: { token: "Zz9".repeat(5) + "Q" } });
  check("unknown invite: 404", unknown.status === 404 && unknown.data?.error === "That invite link doesn't work.", seen(unknown));

  // Removal: only yourself. Leaving from your own phone signs it out and drops you from the list.
  const other = await call("POST", `/profiles/${invitee.id}/remove`, { key: keyA, me: me.id });
  check("can't remove someone else (403 'Only <Name> can remove themselves.')",
    other.status === 403 && other.data?.error === `Only ${invitee.name} can remove themselves.`, seen(other));
  const lockedMe = await call("POST", `/profiles/${invitee.id}/remove`, { key: keyB, me: me.id });
  check("another phone can't act as someone with their own phone (403)",
    lockedMe.status === 403 && lockedMe.data?.error === `${me.name} uses their own phone.`, seen(lockedMe));
  const own = await call("POST", `/profiles/${invitee.id}/remove`, { key: keyB, me: plain.id });
  check("a phone can't remove its own person while acting as someone else (403)",
    own.status === 403 && own.data?.error === `Only ${invitee.name} can remove themselves.`, seen(own));
  const stillB = await call("GET", "/family", { key: keyB });
  check("...and writing as a phone-less face never moves an owned phone",
    stillB.data?.device_profile_id === invitee.id && stillB.data?.profiles?.find?.((p) => p.id === plain.id)?.has_phone === false, seen(stillB));
  const pair = await call("POST", "/threads", { key: keyA, me: me.id, body: { other_id: invitee.id } });
  const said = pair.data?.id
    ? await call("POST", `/threads/${pair.data.id}/messages`, { key: keyA, me: me.id, body: { kind: "text", body: "Live test hello" } })
    : pair;
  check("1:1 text to the invitee", said.status === 200, seen(said));
  const rm = await call("POST", `/profiles/${invitee.id}/remove`, { key: keyB, me: invitee.id });
  check("POST /profiles/:id/remove: they leave from their own phone", rm.status === 200 && rm.data?.ok === true, seen(rm));
  const out = await call("GET", "/family", { key: keyB });
  check("...which signs that phone out: 401 'This phone was signed out.'", out.status === 401 && out.data?.error === SIGNED_OUT, seen(out));
  const after = await call("GET", "/family", { code: CODE });
  check("removed person is gone from GET /family", after.status === 200 && !after.data.profiles.some((p) => p.id === invitee.id), seen(after));
  check("...and kept in former_profiles", after.data?.former_profiles?.some((p) => p.id === invitee.id), seen(after));
  const asGone = await call("GET", "/favorites", { key: keyA, me: invitee.id });
  check("removed person as x-profile-id: 403", asGone.status === 403, seen(asGone));
  const inbox = await call("GET", "/threads", { key: keyA, me: me.id });
  const kept = inbox.data?.find?.((x) => x.id === pair.data?.id);
  check("the 1:1 with them stays in the inbox, marked removed", kept?.other?.removed === true, seen(inbox));
  const late = pair.data?.id ? await call("POST", `/threads/${pair.data.id}/messages`, { key: keyA, me: me.id, body: { kind: "text", body: "Still there?" } }) : pair;
  check("...and takes no new messages (403)", late.status === 403, seen(late));

  // E1: owner set once. A code-swapped key becomes the phone of the first phone-less person it writes
  // as (never a read; never someone only invited), and later writes as other phone-less people never
  // move it. Removing its person signs it out.
  const devC = await call("POST", "/devices", { code: CODE, body: { device_label: "Live test" } });
  const keyC = devC.data?.device_key;
  if (keyC) made.keys.push(keyC);
  const selfOnC = await call("POST", "/profiles/self", { key: keyC, body: { name: me.name, role: "cook" } });
  check("POST /profiles/self with a taken name: 409 'Pick another name or tap your face.'",
    selfOnC.status === 409 && selfOnC.data?.error === `${me.name} is already in this family. Pick another name or tap your face.`, seen(selfOnC));
  const asInvited = await call("POST", `/threads/${cid}/read`, { key: keyC, me: second.id });
  check("nobody writes as someone only invited (403)", asInvited.status === 403 && /hasn't joined yet/.test(asInvited.data?.error ?? ""), seen(asInvited));
  await call("GET", "/favorites", { key: keyC, me: plain.id }); // a read: doesn't set it
  const famC0 = await call("GET", "/family", { key: keyC });
  check("...and neither that nor a read gives the phone a person", famC0.status === 200 && famC0.data?.device_profile_id === null, seen(famC0));
  const wrote = await call("POST", `/threads/${cid}/read`, { key: keyC, me: plain.id });
  const famC = await call("GET", "/family", { key: keyC });
  check("a code-swapped key takes the first phone-less person it writes as", wrote.status === 200 && famC.data?.device_profile_id === plain.id, seen(famC));
  check("...who now has a phone (has_phone true)", famC.data?.profiles?.find?.((p) => p.id === plain.id)?.has_phone === true, seen(famC));
  const plain2R = await call("POST", "/profiles", { code: CODE, body: { name: `Live Plain Two ${tag}`, role: "learner" } });
  const plain2 = plain2R.data?.id ? plain2R.data : null;
  if (plain2) made.profiles.push(plain2.id);
  if (check("POST /profiles (a second phone-less face)", !!plain2, seen(plain2R))) {
    const wrote2 = await call("POST", `/threads/${cid}/read`, { key: keyC, me: plain2.id });
    const famC2 = await call("GET", "/family", { key: keyC });
    check("a phone-less face can still be picked on someone's phone", wrote2.status === 200, seen(wrote2));
    check("...and the phone stays its owner's (owner set once)",
      famC2.data?.device_profile_id === plain.id && famC2.data?.profiles?.find?.((p) => p.id === plain2.id)?.has_phone === false, seen(famC2));
  }
  check("...and someone only invited still reads as invited", famC.data?.profiles?.find?.((p) => p.id === second.id)?.invited === true, seen(famC));
  const rm2 = await call("POST", `/profiles/${plain.id}/remove`, { key: keyA, me: me.id });
  check("can't remove the person a phone belongs to either (403)", rm2.status === 403, seen(rm2));
  const stillC = await call("GET", "/family", { key: keyC });
  check("...which leaves the code-swapped phone signed in", stillC.status === 200, seen(stillC));
  const rm3 = await call("POST", `/profiles/${plain.id}/remove`, { key: keyC, me: plain.id });
  check("they leave from the phone that is theirs", rm3.status === 200, seen(rm3));
  const outC = await call("GET", "/family", { key: keyC });
  check("...which signs out the code-swapped phone (401)", outC.status === 401 && outC.data?.error === SIGNED_OUT, seen(outC));
  // The second person joins with the fresh link, sends a family invite, then leaves.
  const accS = re.data?.invite ? await call("POST", "/invites/accept", { body: { token: tokenOf(re.data.invite), device_label: "Live test" } }) : re;
  const keyS = accS.data?.device_key;
  if (keyS) made.keys.push(keyS);
  if (check("the second person joins with the fresh link", accS.status === 200 && accS.data?.profile_id === second.id, seen(accS))) {
    const sent = await call("POST", "/invites", { key: keyS, me: second.id, body: {} });
    const rmS = await call("POST", `/profiles/${second.id}/remove`, { key: keyS, me: second.id });
    check("...and leaves", rmS.status === 200, seen(rmS));
    if (sent.data?.invite) {
      const peekRm = await call("POST", "/invites/peek", { body: { token: tokenOf(sent.data.invite) } });
      check("leaving turns off the family invites they sent", peekRm.data?.status === "revoked", seen(peekRm));
    }
  }

  // E2: a family invite names nobody; Join makes a phone with no person yet, and posts no note.
  const fi = await call("POST", "/invites", { key: keyA, me: me.id, body: {} });
  const famInv = fi.data?.invite;
  check("POST /invites {} makes a family invite (no profile)", fi.status === 200 && famInv?.profile_id === null && fi.data?.profile === null, seen(fi));
  if (!famInv) return;
  check("family invite url is /i?t=<16 base62>&c=<code>", /\/i\?t=[0-9A-Za-z]{16}&c=[A-HJ-NP-Z2-9]{6}$/.test(famInv.url ?? ""));
  const tF = tokenOf(famInv);
  const peekF = await call("POST", "/invites/peek", { body: { token: tF } });
  check("peek a family invite: pending, invitee null, names the inviter",
    peekF.status === 200 && peekF.data.status === "pending" && peekF.data.invitee === null && peekF.data.inviter?.name === me.name, seen(peekF));
  const accF = await call("POST", "/invites/accept", { body: { token: tF, device_label: "Live test" } });
  const keyF = accF.data?.device_key;
  if (keyF) made.keys.push(keyF);
  check("accept a family invite: a key, profile_id null", accF.status === 200 && KEY_SHAPE.test(keyF ?? "") && accF.data.profile_id === null, seen(accF));
  if (!keyF) return;
  // A: a family-invite phone writes as nobody until it says who it is (reads stay fine).
  const face = plain2 ?? me;
  const claim = await call("POST", `/threads/${cid}/read`, { key: keyF, me: face.id });
  check("a family-invite key writing as an existing face: 403 'Add yourself first.'",
    claim.status === 403 && claim.data?.error === "Add yourself first.", seen(claim));
  if (plain2) {
    const readAs = await call("GET", "/favorites", { key: keyF, me: plain2.id });
    check("...while reads as a phone-less face still work", readAs.status === 200, seen(readAs));
  }
  const againF = await call("POST", "/invites/accept", { body: { token: tF } });
  check("accept it again: 410 used", againF.status === 410 && againF.data?.status === "used", seen(againF));
  const famF = await call("GET", "/family", { key: keyF });
  check("GET /family with that key: device_needs_profile true, no person yet",
    famF.status === 200 && famF.data?.device_needs_profile === true && famF.data?.device_profile_id === null, seen(famF));

  // E3: the phone adds its own person.
  const selfName = `Live Self ${tag}`;
  const selfR = await call("POST", "/profiles/self", { key: keyF, body: { name: selfName, role: "learner" } });
  const selfP = selfR.data?.id ? selfR.data : null;
  if (selfP) made.profiles.push(selfP.id);
  check("POST /profiles/self creates the person", selfR.status === 200 && selfP?.name === selfName && selfP?.role === "learner", seen(selfR));
  if (!selfP) return;
  const famF2 = await call("GET", "/family", { key: keyF });
  check("...device_needs_profile becomes false and the phone is theirs",
    famF2.data?.device_needs_profile === false && famF2.data?.device_profile_id === selfP.id, seen(famF2));
  const notesF = await call("GET", `/threads/${cid}/messages`, { key: keyA, me: me.id });
  check(`...and "<Name> joined." is in the circle`, notesF.data?.some?.((m) => m.kind === "system" && m.body === `${selfName} joined.`), seen(notesF));
  const twice = await call("POST", "/profiles/self", { key: keyF, body: { name: `Live Self Two ${tag}`, role: "cook" } });
  check("a second POST /profiles/self: 409 'This phone already belongs to …'",
    twice.status === 409 && twice.data?.error === `This phone already belongs to ${selfName}.`, seen(twice));

  // E1: the lock. Only their own phone can be them, reads included.
  const lockedText = `${selfName} uses their own phone.`;
  const lockGet = await call("GET", "/threads", { key: keyA, me: selfP.id });
  check("another key acting as them: GET /threads 403 '… uses their own phone.'", lockGet.status === 403 && lockGet.data?.error === lockedText, seen(lockGet));
  const lockPost = await call("POST", `/threads/${cid}/read`, { key: keyA, me: selfP.id });
  check("...and a POST 403", lockPost.status === 403 && lockPost.data?.error === lockedText, seen(lockPost));
  const lockCode = await call("GET", "/favorites", { code: CODE, me: selfP.id });
  check("...and the family code (old builds) 403", lockCode.status === 403 && lockCode.data?.error === lockedText, seen(lockCode));
  const ownerOk = await call("GET", "/threads", { key: keyF, me: selfP.id });
  check("their own phone still works", ownerOk.status === 200, seen(ownerOk));
  const fromA = await call("GET", "/family", { key: keyA, me: selfP.id });
  check("GET /family with a locked x-profile-id still loads (it's ignored)", fromA.status === 200, seen(fromA));
  check("another key sees them locked: true", fromA.data?.profiles?.find?.((p) => p.id === selfP.id)?.locked === true, seen(fromA));
  check("...their own phone sees them unlocked", famF2.data?.profiles?.find?.((p) => p.id === selfP.id)?.locked === false, seen(famF2));

  // B: moving to a new phone. They "lost" keyF and joined again through a family invite.
  const newPhone = async () => {
    const inv = await call("POST", "/invites", { key: keyA, me: me.id, body: {} });
    const acc = inv.data?.invite
      ? await call("POST", "/invites/accept", { body: { token: tokenOf(inv.data.invite), device_label: "Live test" } })
      : inv;
    if (acc.data?.device_key) made.keys.push(acc.data.device_key);
    check("another family invite: a key with no person", acc.status === 200 && KEY_SHAPE.test(acc.data?.device_key ?? "") && acc.data?.profile_id === null, seen(acc));
    return acc.data?.device_key ?? null;
  };
  const keyM = await newPhone();
  let moved = false;
  if (keyM) {
    const ask = await call("POST", "/move-requests", { key: keyM, body: { profile_id: selfP.id } });
    const askId = ask.data?.id;
    check("POST /move-requests: a pending ask to be them",
      ask.status === 200 && !!askId && ask.data?.status === "pending" && ask.data?.profile_id === selfP.id, seen(ask));
    const repeat = await call("POST", "/move-requests", { key: keyM, body: { profile_id: selfP.id } });
    check("...asking again returns the same ask", repeat.status === 200 && repeat.data?.id === askId, seen(repeat));
    const mine0 = await call("GET", "/move-requests/mine", { key: keyM });
    check("GET /move-requests/mine: pending", mine0.status === 200 && mine0.data?.id === askId && mine0.data?.status === "pending", seen(mine0));
    check("...naming who can let them in (asked), not them", Array.isArray(mine0.data?.asked) && !mine0.data.asked.includes(selfName), seen(mine0));
    const listF = await call("GET", "/move-requests", { key: keyF, me: selfP.id });
    check("the person asked for doesn't see an ask to be them", listF.status === 200 && !listF.data?.some?.((r) => r.id === askId), seen(listF));
    const famF3 = await call("GET", "/family", { key: keyF, me: selfP.id });
    check("someone who joined minutes ago can't manage (can_manage false)", famF3.status === 200 && famF3.data?.can_manage === false, seen(famF3));
    if (plain2) {
      const lent = await call("POST", `/move-requests/${askId}/approve`, { code: CODE, me: plain2.id });
      check("approve with the family code: 403 'Only someone on their own phone can let people in.'",
        lent.status === 403 && lent.data?.error === "Only someone on their own phone can let people in.", seen(lent));
    }
    const selfOk = await call("POST", `/move-requests/${askId}/approve`, { key: keyF, me: selfP.id });
    check("...nor answer an ask (403 'You can do this after your first day here.')",
      selfOk.status === 403 && selfOk.data?.error === "You can do this after your first day here.", seen(selfOk));
    const famA3 = await call("GET", "/family", { key: keyA, me: me.id });
    check("GET /family carries can_manage", famA3.status === 200 && typeof famA3.data?.can_manage === "boolean", seen(famA3));
    const settled = famA3.data?.can_manage === true;
    const listA = await call("GET", "/move-requests", { key: keyA, me: me.id });
    if (!settled) {
      console.log(`NOTE ${me.name}'s first test key is under a day old: approve and decline were checked as refused. Run again tomorrow for the full move.`);
      check("not settled yet: GET /move-requests is []", listA.status === 200 && Array.isArray(listA.data) && listA.data.length === 0, seen(listA));
      const early = await call("POST", `/move-requests/${askId}/approve`, { key: keyA, me: me.id });
      check("...and approve is 403 'You can do this after your first day here.'",
        early.status === 403 && early.data?.error === "You can do this after your first day here.", seen(early));
    } else {
      check("someone settled on their own phone sees it in GET /move-requests",
        listA.status === 200 && listA.data?.some?.((r) => r.id === askId && r.profile?.id === selfP.id), seen(listA));
      check("...and counts it in GET /family move_requests_pending", famA3.data?.move_requests_pending >= 1, seen(famA3));
      const ok = await call("POST", `/move-requests/${askId}/approve`, { key: keyA, me: me.id });
      moved = check("approve: { ok: true }", ok.status === 200 && ok.data?.ok === true, seen(ok));
      const famM = await call("GET", "/family", { key: keyM });
      check("...the new key is now that person",
        famM.status === 200 && famM.data?.device_profile_id === selfP.id && famM.data?.device_needs_profile === false, seen(famM));
      const oldF = await call("GET", "/family", { key: keyF });
      check("...and the old key is signed out (401)", oldF.status === 401 && oldF.data?.error === SIGNED_OUT, seen(oldF));
      const mine1 = await call("GET", "/move-requests/mine", { key: keyM });
      check("GET /move-requests/mine: approved", mine1.data?.id === askId && mine1.data?.status === "approved", seen(mine1));
      check("...let_in_by names who did", mine1.data?.let_in_by === me.name, seen(mine1));
      const twiceOk = await call("POST", `/move-requests/${askId}/approve`, { key: keyA, me: me.id });
      check("approve again: 409 'Already handled.'", twiceOk.status === 409 && twiceOk.data?.error === "Already handled.", seen(twiceOk));
      const asThem = await call("GET", "/threads", { key: keyM, me: selfP.id });
      check("...they act as themselves from the new phone", asThem.status === 200, seen(asThem));
      const notesM = await call("GET", `/threads/${cid}/messages`, { key: keyA, me: me.id });
      const sys = (body) => notesM.data?.some?.((m) => m.kind === "system" && m.body === body);
      check("...and moving in left no circle note",
        notesM.status === 200 && !sys(`${selfName} is on a new phone.`) && !sys(`${me.name} let ${selfName} in.`), seen(notesM));

      // Decline: another new key asks to be them; someone else says no.
      const keyD = await newPhone();
      if (keyD) {
        const askD = await call("POST", "/move-requests", { key: keyD, body: { profile_id: selfP.id } });
        check("another ask to be them", askD.status === 200 && askD.data?.status === "pending", seen(askD));
        const no = await call("POST", `/move-requests/${askD.data?.id}/decline`, { key: keyA, me: me.id });
        check("decline: { ok: true }", no.status === 200 && no.data?.ok === true, seen(no));
        const mineD = await call("GET", "/move-requests/mine", { key: keyD });
        check("GET /move-requests/mine: declined", mineD.data?.id === askD.data?.id && mineD.data?.status === "declined", seen(mineD));
        const noAgain = await call("POST", `/move-requests/${askD.data?.id}/decline`, { key: keyA, me: me.id });
        check("decline again: 409 'Already handled.'", noAgain.status === 409 && noAgain.data?.error === "Already handled.", seen(noAgain));
        const famD = await call("GET", "/family", { key: keyD });
        check("...and that phone is still nobody", famD.status === 200 && famD.data?.device_profile_id === null, seen(famD));
        const stillM = await call("GET", "/family", { key: keyM });
        check("...while their phone stays in", stillM.status === 200 && stillM.data?.device_profile_id === selfP.id, seen(stillM));
      }
    }
  }

  const theirs = moved ? keyM : keyF;
  const rmSelf = await call("POST", `/profiles/${selfP.id}/remove`, { key: theirs, me: selfP.id });
  check("they leave from their own phone", rmSelf.status === 200, seen(rmSelf));
  const outF = await call("GET", "/family", { key: theirs });
  check("...which signs it out (401)", outF.status === 401 && outF.data?.error === SIGNED_OUT, seen(outF));
  if (plain2) {
    // Someone with no phone leaves from a lent phone (the test key, as them): it stays signed in.
    const rmLent = await call("POST", `/profiles/${plain2.id}/remove`, { key: keyA, me: plain2.id });
    check("someone with no phone leaves from a lent phone", rmLent.status === 200, seen(rmLent));
    const stillA = await call("GET", "/family", { key: keyA });
    check("...which stays signed in", stillA.status === 200, seen(stillA));
  }

  // A5: the lander's POST /web-events (JSON or sendBeacon's text/plain); /events still takes an old
  // beacon, and the app's recipe events still route.
  const visit = { event: "land", aud: "parent", signal: "default", app: "two_sided_live", path: "/teach", host: "two-sided-live.test" };
  const e1 = await call("POST", "/web-events", { body: visit });
  check("POST /web-events application/json: 204", e1.status === 204, seen(e1));
  const e2 = await call("POST", "/web-events", { raw: JSON.stringify({ ...visit, event: "switch", signal: "switch", ui: "hero" }), type: "text/plain;charset=UTF-8" });
  check("POST /web-events text/plain: 204", e2.status === 204, seen(e2));
  const e3 = await call("POST", "/web-events", { body: { event: "click", aud: "parent" } });
  check("POST /web-events bad body: 400", e3.status === 400, seen(e3));
  const e5 = await call("POST", "/events", { body: visit });
  check("POST /events without a key still logs a lander visit: 204", e5.status === 204, seen(e5));
  // Retention PR 1 widened the kinds (viewed, cooked, started, heard), so match the stem: it passes
  // against the server before and after that deploy.
  const e4 = await call("POST", "/events", { key: keyA, me: me.id, body: { recipe_id: "dad-sunday-chili", kind: "nope" } });
  check("signed-in POST /events still takes recipe events", e4.status === 400 && /^kind must be /.test(e4.data?.error ?? ""), seen(e4));

  // A3: Apple / Google refuse junk.
  const apple = await call("POST", "/auth/apple", { body: { id_token: "not.a.token" } });
  check("POST /auth/apple garbage token: 401", apple.status === 401, seen(apple));
  const google = await call("POST", "/auth/google", { body: { id_token: "not.a.token" } });
  check("POST /auth/google: 503 not set up (or 401 junk)",
    (google.status === 503 && google.data?.error === "Google sign-in isn't set up yet.") || google.status === 401, seen(google));

  // Sign this phone out.
  const revoke = await call("POST", "/devices/revoke", { key: keyA });
  check("POST /devices/revoke", revoke.status === 200, seen(revoke));
  const dead = await call("GET", "/family", { key: keyA });
  check("revoked key: 401", dead.status === 401 && dead.data?.error === SIGNED_OUT, seen(dead));
}

async function cleanUp() {
  // Keys first: while a test key is someone's phone, the family code can't act as them. Then each
  // test person still here leaves as themselves (nobody removes anyone else).
  for (const key of made.keys) await call("POST", "/devices/revoke", { key }); // 401 when already revoked: fine
  const fam = await call("GET", "/family", { code: CODE });
  const left = made.profiles.filter((id) => fam.data?.profiles?.some?.((p) => p.id === id));
  let stuck = 0;
  for (const id of left) {
    const r = await call("POST", `/profiles/${id}/remove`, { code: CODE, me: id });
    if (r.status !== 200) stuck++;
  }
  if (stuck) console.log(`NOTE ${stuck} test people left in the test family (only invited: they can't leave until they join)`);
}

try {
  await run();
} catch (e) {
  check("live run finished", false, e.message);
} finally {
  await cleanUp();
}
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
