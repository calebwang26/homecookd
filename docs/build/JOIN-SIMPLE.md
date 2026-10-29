# Joining a family: only by a join link (design)

Caleb, Oct 29: "It should literally just be from clicking a join link. That should be the only mechanism that
allows you to join a family." Owner: Notifications & linking. Status: **approved** by the head agent (Oct 29), with the §8 answers. Mockups: `docs/design/join-simple/join-simple.jpg`. It's
built on `claude/join-simple`, off the local integration branch `claude/v2-batch` (60340e07c). Local commits only.

## 0. In one minute

- **Join links are the only way into a family.** There are two kinds:
  - the family's join link, `homecookd.app/i?t=…`. It works for anyone, any number of times, for 7 days, so it can
    go in the family group chat once;
  - a v2 recipe link: the kid's Ask Mom link `/a?t=…`, and the card links that come from a parent's craving link
    `/miss?c=…`. These keep Phase 4's rules: one join per side, a 30-day window.
- **The order is "name, then sign into apple acc".** Tap the link → "Join the Pawar family. What do they call
  you?" → Sign in with Apple (Google on Android only) → in. The family chat says "Asha joined".
- **Starting a family is the one path without a link:** Sign in with Apple, then today's name → role → language.
- **Someone already in a family** who taps another family's link is asked "You're in the Wang family. Join the
  Pawar family instead?". One tap moves them; nothing moves without it.
- **Gone from the 1.1 app:**
  - the 6-letter codes and `/join-code`;
  - signing in with the family code;
  - the Paste invite button;
  - per-person invites ("Send again", "Hasn't joined yet").

  Picking up a copied link after install stays, but invisible, with "Tap your link again" as the backup that always
  works. "Add someone without a phone" stays: it isn't joining.
- **Old builds keep working.** The server keeps every old path until 1.0 is retired; only the 1.1 app stops offering
  them.

## 1. Screens

```
JOIN LINK (/i?t=…, or /a?t=… with a ticket)                 FIRST SCREEN (no link)
┌──────────────────────────────┐                             ┌──────────────────────────────┐
│   [family faces]             │                             │ homecookd                    │
│ Join the Pawar family        │                             │ Cook your family's food.     │
│ Mom sent this.               │  (/a: "Caleb's tomato egg") │                              │
│ What do they call you?       │                             │ [  Sign in with Apple  ]     │
│ [ Asha                     ] │                             │ (Google: Android only)       │
│ [  Sign in with Apple  ]     │                             │ Got a link from your family? │
│ terms line                   │                             │ Tap it again.                │
└──────────────────────────────┘                             └──────────────────────────────┘
ALREADY IN ANOTHER FAMILY                                    LINK THAT DOESN'T WORK
┌──────────────────────────────┐                             ┌──────────────────────────────┐
│ You're in the Wang family.   │                             │ This link expired.           │
│ Join the Pawar family        │                             │ Ask Mom for a new one.       │
│ instead?                     │                             │ [ Back to start ]            │
│ [ Join the Pawars ] Not now  │                             └──────────────────────────────┘
└──────────────────────────────┘
```

1. **A join link opens the app.** It comes from a universal link, `homecookd://`, or the invisible pickup (§2).
   - The app peeks: the family's name, who sent the link, the inviter's face.
   - The card shows "Join the <family> family", one line naming the sender, a name field ("What do they call
     you?"), and Sign in with Apple. On Android it's Google.
   - A recipe link shows the dish ("Caleb's tomato egg") in place of the family line.
   - The name is prefilled when the link knows it: the kid's name on a card, "Mom" on an ask.
2. **Sign in with Apple, then one server call** with the name, the link and the identity (§3). It returns the phone's
   key. They land on their home, or on the card's screen for a recipe link. The family chat gets "Asha joined".
3. **Role:**
   - A recipe link sets it: the kid is a learner, Mom a cook.
   - **A family join link: open question (§8.1).** Recommended: two small chips under the name, "I cook" /
     "I miss the food", with "I miss the food" picked. No extra screen.
   - Cooks then get today's language pick.
4. **No link:** the first screen offers Sign in with Apple only, which starts a family with today's name → role →
   language. Under it, a small line: "Got a link from your family? Tap it again."
5. **Signed in to another family, tapping a link:**
   - The app asks "You're in the <A> family. Join the <B> family instead?" with "Join the <B>s" and "Not now".
   - "Join" runs Sign in with Apple again (the server needs proof it's the same person) and moves them (§4).
   - "Not now" changes nothing.
6. **Signed in to the same family:** "You're already in." → home (as today).
7. **A link that doesn't work:** expired, turned off, unknown, or a recipe side that's taken or past its 30 days. It
   shows the server's sentence, "Ask <sender> for a new one.", and Back to start.

Mockups of 1, 4 and 5 and the web `/i` page (§6) go to the head agent before the screens are built.

## 2. Getting a link in after installing (invisible)

- **The web.** The `/i`, `/miss` and `/a` pages copy the link inside the "Get the app" tap, as they do today, and say
  "Copied. Open homecookd and it picks up your link."
- **The app's first launch, signed out.**
  - On iOS, `Clipboard.hasUrlAsync()` checks for a link without a prompt. Only when it says yes does the app read it,
    and then iOS shows its own one-time "Allow Paste" prompt. This is the system's, not a button of ours.
  - When a homecookd join link is there, the app opens it (step 1). Anything else is ignored.
- **The backup that always works:** the first screen's "Got a link from your family? Tap it again." A link tapped from
  Messages or WhatsApp opens the app directly.
- **What's removed:** the Paste invite row and its native paste button, and typing a code.

## 3. Server (Supabase): what changes

Everything here is additive. It deploys after Apple approves 1.0, under Caleb's pre-approval and AGENTS.md's api
deploy rules.

- **New table `join_links`** (migration):
  - `id`, `family_id`, `inviter_id`, `token_hash` (unique; the token is 22 base62 characters);
  - `expires_at` (null = never: only for the TEST family, §5), `revoked_at`, `created_at`;
  - RLS on, no policies.
- **`POST /join-links`** (a member, signed in) → `{ url: "<WEB_URL>/i?t=<token>", expires_at }`.
  - It returns the family's live link while it has more than a day left, so "Invite family" shows the same link all
    week.
  - `JOIN_LINK_DAYS = 7` (`TODO(caleb)`).
  - `POST /join-links/revoke` turns it off; the next call makes a new one.
- **`/invites/peek`** also takes a 22-character token. It answers from `join_links` with the same shape (`status`,
  `family_name`, `inviter`, `expires_at`, `same_family`) plus `kind: "link"`. Old 16-character invite tokens and codes
  answer as today.
- **`POST /auth/apple` and `/auth/google`** take one of `join_token` (a family join link) or `link_ticket` (Phase 4's
  signed ticket from `/link/open`), plus the name and the role.
  - **A new identity:**
    - `name` is required (`needs_name` as today);
    - it joins the link's family as a new profile;
    - it links the identity and makes a device, a signups row and the "<name> joined" note.
    - A ticket keeps Phase 4's rules: one join per card side through `signups` `link:<card>:<side>` and its unique
      index, and the role comes from the side.
  - **A known identity in that family:** signs in as today. The link isn't "used up".
  - **A known identity in another family:** nothing changes. It answers `{ needs_move: true, from_family, to_family }`.
    Called again with `move: true`, it moves them (§4).
  - **No link:** today's path. A known identity signs in; a new one starts a family (`startFamily`).
- **`POST /auth/link`** (Phase 4's join by ticket with no Apple) is removed before it ever ships. Its ticket check
  and one-join-per-side code move into the Apple/Google path. The `signups` unique-index migration stays.
- **The 1.1 app stops calling:**
  - `POST /invites` (one-use links with codes);
  - `/invites/accept`;
  - `POST /profiles/self` after an invite;
  - code sign-in (`/auth/email`, `x-family-code` swaps);
  - `share_token` joins (§3.1).

  They all stay on the server for 1.0 (§6).

### 3.1 The older recipe link `/r?s=…`

Rule 1 names `/i` and the v2 recipe links, not `/r`. So in 1.1, `/r` opens the shared dish but no longer joins a
family: signed out, it leads to Sign in with Apple to start their own. Today's server still joins by `share_token`
for 1.0.

## 4. Moving to another family (rule 4)

A move happens only after "Join the <B>s" and a fresh Apple sign-in. In one server call:

- **In family A:**
  - Their profile leaves exactly as "Leave the family" does today (`/profiles/:id/remove`): `removed_at`, their phones
    signed out, the invites they sent turned off.
  - Their messages, 1:1 chats and recipe notes stay in A, under their name and face.
  - A's chat says "<name> left".
- **In family B:**
  - They get a new profile with the name they typed and the role from the link or the chips.
  - Their Apple identity moves to it, this phone gets a new key, and B's chat says "<name> joined".
- **Their recipes (Convex):**
  - **When others still sign in to A,** the recipes stay with A. They're the family's, as when someone leaves today.
  - **When they were the only one who signs in to A** (a cold parent who started her own family, then got her kid's
    link), the recipes come with them:
    - the recipes, their jobs and recordings get `familyId` B and `cookId` the new person;
    - the phone-less faces they added go too;
    - both families' Moss indexes re-sync.
  - **How Convex knows the move is real:** the server returns `moved: { receipt }`, an HMAC with the same
    `LINK_JOIN_SECRET` over `{ fromProfile, fromFamily, toProfile, toFamily, exp }`. The app passes it to the new
    `links.moved({ sessionToken, receipt })`, and Convex checks it before re-homing anything. `TODO(caleb)`: this is
    the recommended default. The alternative is that recipes always stay with A.
- **Account deletion afterwards:** it covers the new person. The old profile in A is a removed person, as after Leave
  today.

## 5. Apple's reviewer

- **Today** the reviewer signs in with the TEST family code (`docs/build/.test-family-code`), through "Have a family
  code?".
- **In 1.1:** the reviewer notes give a TEST family join link that never expires (`join_links.expires_at` null), made
  once by an operator script, `scripts/test-family-link.mjs` (TEST family only; it refuses any other family).
  - The reviewer taps it on the review device → types a name → Sign in with Apple with their own Apple ID.
  - They're in the TEST family, with its recipes (Chicken Biryani) and the faces of Mom, Dad, Grandma, Leo and Maya.
  - Each review adds one person to the TEST family; nothing of the TEST family is deleted or renamed.
- **App Review guard, per guideline** (to restate in the 1.1 PR):
  - **4.8 Login services:** on iOS, Sign in with Apple is the only way in, and Google shows on Android only. With no
    other login on iOS, 4.8 is met.
  - **5.1.1 Data collection:** a join stores only a name, a role and the Apple identity (as today's Apple sign-in).
    Signing in is needed because the family's shared recipes, voices and chat are the core feature.
  - **5.1.1(v) Account deletion:** unchanged and works for every person, a moved one included.
  - **2.1 Completeness / demo access:** the reviewer gets in with the permanent TEST join link and their own Apple
    ID. No account to hand over, no code.
  - **5.1.2(i) AI consent:** unchanged.
- **Lines that mention codes or Paste invite, for App Store, web & builds to update in the 1.1 submission (not now):**
  - the handoff doc "homecookd App Store submission for Salik": the reviewer notes' sign-in steps (the family code),
    and any screenshot captions or answers that mention a code or Paste invite;
  - `web/src/components/invite/InvitePage.tsx` ("Or type this code in the app") and `Handoff.tsx` ("Copied. In the
    app, tap Paste invite.");
  - `docs/agents/memory/app-review-guard.md` (lists `join-code.tsx` and "Have a family code?");
  - the docs that describe codes: `API.md`, `SPEC.md`, `FEEDBACK-OCT16c.md`, `RETENTION-HANDOFF.md`, and the AGENTS.md
    deploy note for `.test-family-code`.
  - /privacy and /terms don't mention codes (checked).

## 6. Old builds (1.0, build 6)

- **The server keeps every old path:**
  - one-use invites with codes (`POST /invites`, `/invites/accept`, peek by code);
  - per-person invites;
  - `x-family-code`;
  - `/auth/email`;
  - `share_token` joins;
  - `/profiles/self`.
- **A 1.1 join link (22 characters) opened by a 1.0 app:**
  - 1.0's parser ignores it.
  - If it reaches `/invites/accept` anyway, the server answers `426` "Update homecookd to join this family." The page
    shows that sentence.
- **A 1.0 phone signed in with a family code that updates to 1.1:** it keeps today's boot swap of the saved code for
  a device key, with no screen. So nobody is signed out by the update.
- **`x-family-code` itself stays,** because the pipeline and the web use it.
- **When the old paths can go:** once 1.0 is retired (App Store Connect shows about every active phone on 1.1+, or a
  minimum version is enforced). Then code sign-in, code peeks, `/auth/email` and the one-use invite routes can be
  turned off in one api release. `TODO(caleb)`: when.

## 7. Who builds what

| Piece | Files | Chat |
|---|---|---|
| Supabase: `join_links` migration, `/join-links`, peek, `/auth/apple|google` with `join_token` / `link_ticket` / `move`, the move, remove `/auth/link`, deno tests | `supabase/functions/api/index.ts`, `link.ts`, a new `joinLinks.ts`, migrations, `supabase/tests/` | **Notifications & linking** (Convex & accounts reviews: it owns `supabase/`) |
| Convex: `links.moved` (verify the receipt, re-home a solo family's recipes and Moss) | `convex/links.ts`, a lib for the receipt, tests | **Notifications & linking** (Convex & accounts reviews) |
| App sign-in: the join card on `/i` and in ClaimLink (name → Apple), "Join the <B>s instead?", the first screen (Apple only + "Tap it again"), the invisible pickup, remove `/join-code` and PasteInvite, session's sign-in params and move | `app/src/app/i.tsx`, `join.tsx`, `join-code.tsx` (deleted), `components/signin/*`, `lib/session.tsx`, `lib/api.ts`, `lib/auth/links.ts`, `lib/linkClaim.ts`, `_layout.tsx` | **Notifications & linking**; told to App screens & recording, who shares `components/signin` |
| Remove per-person invites; "Invite family" shares the family join link | `components/profiles/PersonSheet.tsx`, `AddFamilySheet.tsx`, `components/messages/MembersSheet.tsx`, `lib/invites.ts` | **App screens & recording** (I'll send the `POST /join-links` client) |
| Web `/i`: "Join the <family> family" + Get the app / Open homecookd, no code; Handoff's copy line; peek for 22-char tokens | `web/src/components/invite/*`, `web/src/lib/*` | **App Store, web & builds** |
| Reviewer notes, handoff doc, App Store answers, the TEST join link in the notes | the handoff doc, `docs/agents/memory/app-review-guard.md` | **App Store, web & builds**, in the 1.1 submission |

**Tests:**
- Supabase deno: join by link (new and known identities); a known identity in another family gets `needs_move`, then
  moves only with `move: true`; expiry; a revoked link; the old one-use invites and codes still pass their tests; the
  426 for a 1.0 accept.
- Convex vitest: `links.moved` checks the receipt, and re-homes recipes only for a solo family.
- App:
  - `test-signin` is updated for the first screen without codes;
  - `test-links` adds `/i` join tokens;
  - `test-consent` still passes;
  - tsc and lint.

## 8. Decided (head agent, Oct 29)

1. **Role on a family join link:** two chips under the name, "I cook" / "I miss the food", with the second picked. No
   extra step.
2. **A solo family's recipes move with the person,** checked in Convex by the HMAC "moved" receipt (§4).
   `TODO(caleb)`.
3. **The old paths are turned off 30 days after 1.1 is live in the App Store** (§6). `TODO(caleb)`, with a STATE.md
   line.
