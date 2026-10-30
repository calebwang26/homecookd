# Dish ask: the v2 web backend (Phase 1)

The route contract for `docs/PRD-V2.md` Phase 1. With it, the web pages (Phases 2–3) can be built in parallel.
- **Kid:** a kid on homecookd.app, with no account, names a dish and gets tonight's version. Then they send Mom an Ask
  Mom link.
- **Mom:** she opens the link with no account. She hears the kid's voice note, sees the kid's guess, and answers by
  voice. Her version replaces the guess.

This ports the logic of the unshipped MVP "The dish I miss" (calebwang26/homecookd PR #40,
`docs/build/DISH-I-MISS-SPEC.md` and `supabase/functions/miss/` on `feat/dish-i-miss`): its prompts, draft and
merge rules, recipe shapes and limits. What changes:
- the backend is Convex, not Supabase;
- Cartesia Ink writes down voice, not Gemini;
- Mom's words in another language get an English translation;
- the kid gets an editable Ask Mom message and can send a voice note to Mom;
- Mom sees the kid's guess;
- both tokens are stored hashed.

Code: `convex/dishAsks.ts` (data), `convex/dishAskModel.ts` (the model calls), `convex/lib/dishAsk/` (types,
validators, prompts, ported from the MVP), `convex/lib/dishAskRoutes.ts` (HTTP), `convex/lib/rateLimit.ts`.

## 1. Basics

- **Base URL:** the Convex site, `https://grand-dragon-649.convex.site` (`NEXT_PUBLIC_CONVEX_SITE_URL` on the web).
  Every path starts with `/dish/`.
- **CORS:** the same as `/invite/open` (`lib/inviteRoutes.ts`): `https://homecookd.app`, `https://www.homecookd.app`
  and `http://localhost|127.0.0.1|[::1]` on any port. Any other `Origin` gets `403`; a request with no `Origin`
  is allowed. Methods `POST, OPTIONS`; allowed headers `Content-Type, X-Dish-Token`.
- **Bodies:** JSON (`{…}`, at most 64 KB), except the two file routes, which take the raw file. A JSON body is
  read as JSON whatever its `Content-Type`, so the web may send `text/plain` with `keepalive` (no preflight).
- **Replies:** JSON. An error is `{"error": "<a sentence a person can read>", "code": "<code>"}`.

| Status | `code` | When |
|---|---|---|
| 400 | `bad_request` | bad or missing input (the sentence says which) |
| 403 | `origin` | the request came from another site |
| 404 | `not_found` | unknown token or file ("This link doesn't work anymore.") |
| 409 | `closed` | Mom already sent her answers, or that question was already answered (see each route) |
| 413 | `too_large` | body or file too big |
| 415 | `bad_type` | a file type we don't take |
| 422 | `not_a_dish` | the words don't name a dish |
| 422 | `words` | a filtered word in the dish, the message, a question or the AI's output |
| 429 | `rate` | over a per-IP or per-link limit ("Too many tries. Please wait a few minutes") |
| 429 | `budget` | today's model budget is spent ("homecookd has made all the recipes it can today. Try again tomorrow.") |
| 502 | `model` | a model failed; retrying is safe |
| 503 | `not_set_up` | `ANTHROPIC_API_KEY` (or `CARTESIA_API_KEY` for a voice note) isn't set |

## 2. Tokens

- **Kid token:** 22 random base62 characters, made with `crypto.getRandomValues`. Only its sha256 is stored
  (`kidTokenHash`). It reads and edits the card. The kid keeps it in the page URL (`/miss?k=…`) and in
  localStorage.
- **Ask token:** 22 base62 characters made from the kid token: the first 22 base62 characters of
  sha256(`"ask:" + kidToken`). Only its own sha256 is stored (`askTokenHash`).
  - The server can rebuild the ask link from the kid token, so the kid can always re-send it.
  - Nobody can get the kid token from it. It only lets someone see the guess and answer the asked questions.
- **Where tokens travel:**
  - In JSON routes, as `kidToken` / `askToken` in the body.
  - In the raw-file route, as the `X-Dish-Token` header. Tokens never go in a query string.
- **File ids:** `fileId` is 22 base62 characters that name one uploaded file. Only its sha256 is stored.
- No route takes or returns a Convex document id.
- **Bad tokens are rate limited:** 20 unknown tokens per IP in 10 minutes, then `429`.

## 3. Shapes

The recipe shapes are the MVP's (`convex/lib/dishAsk/types.ts`, ported from `supabase/functions/miss/types.ts`),
with one field added: `isGuess` on each ingredient and line.

```ts
type Relation = "mom" | "dad" | "grandma" | "grandpa" | "auntie" | "uncle" | "none"; // none: no one in particular (§10)
type QuestionId = "q1" | "q2" | "q3" | "q4" | "q5" | "q6"; // q1–q3 suggested with the card, q4–q6 the kid's own
type Status = "stated" | "guessed" | "unknown" | "mom";   // where a value came from (see below)

type Ingredient = {
  name: string;       // "tomatoes, in wedges"
  amount: string;     // the estimate: "4" | "~3 medium" | "" (unknown) | "two big spoons" (Mom's words)
  status: Status;
  isGuess: boolean;   // status is "guessed" or "unknown": show it as the kid's guess ("Caleb thinks…")
  ask: QuestionId | null;  // the question that would settle it
  clip: QuestionId | null; // the answer whose clip backs it (Mom's version)
  // Mom's version only, on what her answer changed (status "mom"); null everywhere else:
  was: string | null;      // the guess's amount it replaced ("~1 tbsp"), to strike through; null for a new one
  quote: Quote | null;     // her words that settled it
};
type Line = {
  text: string; detail: string | null; status: Status; isGuess: boolean; ask: QuestionId | null; clip: QuestionId | null;
  was: string | null;      // the guess's line text it replaced; null for a new line
  quote: Quote | null;
};
/** A short piece of her answer, word for word in her language, plus its English (null when she spoke English).
 *  "Two big spoons. Don't be shy." or "दो बड़े चम्मच केचप डालती हूँ" with "I add two big spoons of ketchup". */
type Quote = { words: string; english: string | null };
type Step = { title: string; lines: Line[]; uses: number[]; tip: { words: string; english: string | null; clip: QuestionId } | null };
type Question = { id: QuestionId; text: string };
type Recipe = {
  dish: string;            // "tomato egg"
  servings: string | null; // always "1": tonight's version
  time: string | null;     // "~20 min"
  cost: string | null;     // "~$3" or null
  ingredients: Ingredient[]; steps: Step[];
  questions: Question[];   // exactly 3 suggestions, q1–q3
};
```

The `Status` values:
- `stated`: the kid's words, or a photo or voice note, gave it.
- `guessed`: our estimate. It starts with `~`.
- `unknown`: nobody knows it yet. `amount` is `""`.
- `mom`: her answer settled it (only in her version).

`**bold**` marks amounts, heat and times in a line, and the cue in "Ready when **…**".

```ts
type Card = {                 // what the kid's page gets
  dish: string;               // the dish as the kid typed it, trimmed
  relation: Relation;         // who they're asking (default "mom")
  kidName: string | null;     // shown to Mom ("Caleb thinks…"), at most 40 characters
  status: "draft" | "asked" | "answered";
  guess: Recipe;              // tonight's version, the kid's guess
  version: Recipe | null;     // Mom's version, once her answers are merged
  answers: Answer[];          // her answers behind the version (empty until then)
  merging: boolean;           // her Send is in and her version is being written ("Mom is writing it in her words")
  filmingDay: number | null;  // 0 (Sunday) to 6: the day Mom plans to film it (§8), else null
  asked: Question[];          // what Mom is asked, in order (0–6)
  message: string;            // the Ask Mom message, in the kid's voice, editable
  kidVoiceUrl: string | null; // the kid's voice note to Mom (a Convex storage URL)
  kidVoiceS: number | null;   // its length in seconds, as the page measured it (cards/update `voiceNoteS`)
  photoUrls: string[];        // the photos the card was made from (0–3)
  askUrl: string | null;      // https://homecookd.app/a?t=<ask token>; null while relation is "none" (§10)
  askedAt: number | null; openedAt: number | null; finishedAt: number | null; // ms since epoch
  createdAt: number;
  filmingDay: number | null;  // the day Mom plans to film it, 0 (Sunday) to 6 (§8 cravings.setFilmingDay)
};
type Answer = { id: QuestionId; words: string; english: string | null; audioUrl: string | null; durationS: number };

type Ask = {                  // what Mom's page gets; never the kid token
  dish: string; relation: Relation; kidName: string | null;
  message: string; kidVoiceUrl: string | null; kidVoiceS: number | null;
  guess: Recipe;              // the kid's guess, shown as theirs
  inLang: {                   // the same in the page's language (peek's `lang`), or null
    lang: string;
    guess: Recipe;            // names, amounts, titles, lines, details and questions translated; ids, statuses,
                              // `uses` and ** marks unchanged
    questions: Question[];    // the asked questions, translated
    message: string;          // the kid's message, translated
    version: Recipe | null;   // her version, translated (her quotes and tips stay as she said them)
  } | null;
  photoUrls: string[];        // the kid's photos (0–3)
  questions: Question[];      // asked and not answered yet, in order
  answered: QuestionId[];
  clips: { id: QuestionId; audioUrl: string | null; durationS: number }[]; // her own answers, to play back ("Hear Mom say it")
  finished: boolean;          // she pressed Send (or every asked question is answered and merged)
  version: Recipe | null;     // her version once merged (for the fill-in animation); null while it's being written
  merging: boolean;           // true from Send until her version lands (about 10–20 s) or fails
};
```

## 4. Routes

### Files (kid photos and voice notes)

**`POST /dish/files?kind=photo|voice`**: the raw file as the body, with its `Content-Type`.
- Checked before anything is stored:
  - `Content-Length` and the bytes read;
  - the type.
- `photo`: `image/jpeg`, `image/png` or `image/webp`, at most 5 MB. The web resizes to 1600 px JPEG first.
- `voice`: `audio/webm`, `audio/ogg`, `audio/mp4`, `audio/m4a`, `audio/x-m4a`, `audio/aac`, `audio/mpeg`,
  `audio/wav`, at most 3 MB. That covers Chrome's and Firefox's MediaRecorder (webm/ogg Opus) and Safari and iPhone
  (mp4/AAC). Codec parameters after `;` are ignored.
- Returns `201 {fileId, kind, contentType, size}`.
- Errors: `413` too big, `415` wrong type, `429` (30 files per IP in 10 minutes).
- A file not attached to a card within **1 hour** is deleted (a cron, `dishAsks.dropOrphanFiles`).
- A file can be attached once.

### Kid

**`POST /dish/cards`** `{dish, relation?, kidName?, photos?: fileId[], voiceNote?: fileId}` → `201 {kidToken, card}`
- `dish`: 2–200 characters, trimmed. It may be empty when there's a photo or voice note.
- `relation` defaults to `mom`. `kidName` is at most 40 characters.
- At most 3 `photos`, of kind `photo`. `voiceNote` must be of kind `voice`: it's what the kid says about the dish
  ("she puts a lot of ketchup").
  - It's kept privately on the card (`dishVoiceNote`): neither the card nor Mom's page ever gets it, and only account
    deletion removes it (§5).
- Order of work:
  1. The word filter runs on `dish` and `kidName`.
  2. The voice note is written down by Ink, in English.
  3. Claude writes the guess (the MVP's draft prompt and rules: tonight's version, one serving, about 20 minutes,
     about $N). The photos go to Claude as images.
  4. The filter runs on the guess.
- About 4–8 s; the web waits up to 60 s.
- There's no limit on how many cards a kid makes (Caleb, Oct 29: "they should be able to generate infinite
  recipes"). Only the per-IP limits below and the daily budget (§6) apply. Keeping and saving them is what the app
  is for; each card's own link keeps working.
- `message` starts as "<Relation>, how do you make your <dish>? I'm trying to make it here." (relation in its
  usual form: "Mom", "Grandma"…). The kid edits it with `/dish/cards/update`.
- Errors: `422 not_a_dish`, `422 words`, `429`, `502`, `503`.
- **Limits per IP:** 6 cards in 10 minutes and 30 a day.
- **Daily budget** (§6): once today's model spend reaches $10, the route answers `429 rate`: "homecookd has made
  all the recipes it can today. Try again tomorrow." This replaces the MVP's 500-cards-a-day count.

**`POST /dish/cards/get`** `{kidToken}` → `{card}`
- It also starts a merge that's due: a failed try is retried, at least 3 minutes after the last one.

**`POST /dish/cards/update`** `{kidToken, relation?, kidName?, message?, voiceNote?: fileId | null, voiceNoteS?}` → `{card}`
- `message`: 1–500 characters after trimming, word-filtered. This is the Ask Mom text.
- `voiceNote`: the kid's voice note *to Mom*. It is played first on her page and isn't sent to any model; `null`
  removes it. A new one replaces and deletes the old file.
- A voice note for Mom may be at most 60 s. The web enforces this; the server only checks the 3 MB cap.
- `voiceNoteS` is its length in seconds, as the page measured it (Chrome's webm often has no duration in the file),
  more than 0 and at most 60. It shows as `kidVoiceS` on both pages.
- Once Mom has finished, `message` and `voiceNote` give `409 closed`.

**`POST /dish/cards/ask`** `{kidToken, questions: [{id?, text?, about?}]}` → `{card}` (`about`: §10)
- What Mom is asked. These are the MVP's rules (`/cards/ask`), unchanged:
  - her answered questions stay first;
  - at most 3 open at a time and 6 in all;
  - `q1`–`q3` keep their gap link even when reworded;
  - the kid's own questions get `q4`–`q6`;
  - text is 3–120 characters and word-filtered;
  - `409 closed` when everything given was already answered.
- If Mom had finished, this reopens her link on the new questions.
- Rate: 30 per IP in 10 minutes.

**`POST /dish/cards/sent`** `{kidToken, via: "copy"|"sms"|"instagram"|"whatsapp"|"more"}` → `{card}`
- Marks the card asked: `askedAt` the first time, and `draft` → `asked`.
- The web calls it when the share sheet opens a channel.
- Card statuses:
  - `draft` until sent;
  - `asked` while Mom's link is open or her answers are being merged;
  - `answered` once there's a version, or once no version will come (her clips are then in `answers` with
    `words: ""`).

### Mom

**`POST /dish/ask/peek`** `{askToken, lang?}` → `{ask}`
- Sets `openedAt` the first time.
- **`lang`** is the language Mom's page is shown in: her phone's language, which she can change (Caleb's pick).
  It's one of the answer languages (§4 `/dish/ask/answer`).
  - In any language but `en`, `inLang` carries the guess, the asked questions and the kid's message in that
    language, so she can read the guess and correct it. `guess`, `questions` and `message` stay in English
    alongside.
  - Each card is translated once per language (Claude, `TRANSLATE_MODEL`) and cached. It's translated again only
    when the asked questions or the message change. It counts against the daily budget like Mom's answers (§6),
    with the same $1 overage. Past that, or when translation fails, `inLang` is null and the page shows English.
  - The first peek in a new language takes about 5–15 s. The page shows English at once with `lang` left out, then
    asks again with `lang`.
  - `en`, an unknown code, or no `lang` means no translation (`inLang: null`).
  - The kid's own card always stays in English.
  - **Her version** is translated in the merge, before it's saved, into the language her page last asked for. So
    `inLang.version` lands with `version` for the fill-in. A failure leaves it English until a later peek.
- Mom's page polls it every 2 s after Send until `version` is set or `merging` is false.

**`POST /dish/ask/answer?q=<id>&lang=<code>&durationS=<n>`**: header `X-Dish-Token: <askToken>`, body: the raw
audio. Returns `{ask}`.
- One answer to one asked question. The same audio types as voice files, at most 5 MB and 120 s (125 s is accepted
  and saved as 120).
- `lang` is the language she speaks, for Ink. It defaults to `en` and is one of: `en hi mr gu ta te pa ur bn zh ko
  es tl ar pt vi`. Mom's page asks once and remembers.
- A re-record replaces the answer and deletes the old clip.
- Errors:
  - `400 "That question wasn't asked."`;
  - `409 closed` after Send;
  - `429` (30 per IP in 10 minutes).
- Ink writes it down, and Claude translates it into English when `lang` isn't `en`. Both run in the background:
  Send never waits for them.

**`POST /dish/ask/finish`** `{askToken}` → `{ask}` with `finished: true, merging: true`. This is the "Sent to <kid>"
moment.
- The merge runs after the reply:
  1. Ink writes down any answer it hasn't yet.
  2. Claude translates.
  3. Claude writes her version with the MVP's merge prompt and rules: hers only when it's in her words, removals
     only when she says no, tips verbatim.
  4. The word filter runs on the output.
- **Her words and the English** (Caleb, Oct 29: "Her words + English"):
  - Every answer keeps what she said in her own language (`words`) next to the English (`english`, null when she
    spoke English), with her clip. That's `Card.answers`, and `tip.words` / `tip.english` on a step.
  - The merge prompt gets both. A tip is an excerpt of her original words, verbatim, with its English.
  - An amount or line she settled uses her wording: her own words when she spoke English, and the English of her
    words otherwise, so the kid can cook from it. The `clip` on that ingredient or line plays her saying it.
  - Each ingredient or line she changed also carries:
    - `was`, the guess's value it replaced, so the page can strike it through;
    - `quote`, the short piece of her answer that settled it: word for word in her language, with its English.

    Claude gives the quote with each change, as it gives a tip: her words, copied exactly, and their English. The
    server keeps it only when the words are word for word in that clip's transcript.
    - Otherwise the quote is that whole answer's words and English, each cut at a word to 120 characters.
- About 10–20 s.
- With nothing answered, it changes nothing (`finished: false`).
- Tries: at most 5, at least 3 minutes apart.
- When no version will come (no words heard, or every try failed), `merging` turns false and her clips go to the
  kid as they are.

## 5. Data (`convex/schema.ts`)

Everything is kept forever for now (Caleb, Oct 29: "idealy forever right now"): cards, answers, photos and voice
notes have no expiry, and there's no `410`.

**`dishAsks`**: one card.
- **Tokens:** `kidTokenHash`, `askTokenHash`.
- **What the kid gave:** `dish`, `relation`, `kidName?`, `photos: Id<"_storage">[]`,
  `dishVoiceNote?: Id<"_storage">` (about the dish, private), `kidVoiceNote?: Id<"_storage">` (to Mom).
- **The guess:** `guess` (Recipe), `message`, `asked: Question[]`.
- **Mom's side:** `version?` (Recipe), `status`.
- **Merge state:** `mergeTries`, `mergeStartedAt?`, `mergedAt?`.
- **Funnel times:** `askedAt?`, `askedVia?`, `openedAt?`, `finishedAt?`, `questionsAt?`, `genMs`, `createdAt`.
- **Who:** `ipKey` (an HMAC of the IP, for the limits), plus fields the Phase 4 chat fills when someone claims a
  card in the app (`docs/build/V2-LINKING.md`):
  - `personId?`: the kid;
  - `requestedOf?`: Mom (or the parent who sent a craving link);
  - `familyId?`;
  - `kidClaimedAt?`, `cookClaimedAt?`: the first claim of each side, never cleared.
- **Indexes:** `by_kid_token`, `by_ask_token`, `by_family`, `by_person`, `by_requested_of`.

**`dishAnswers`**: one of Mom's answers.
- `askId`, `questionId`, `audio: Id<"_storage">`, `durationS`, `language`.
- `words?` (Ink's transcript), `english?` (the translation), `merged`, `createdAt`.
- Index `by_ask_question`.

**`dishFiles`**: an upload.
- `fileIdHash`, `storageId`, `kind`, `contentType`, `size`, `ipKey`, `askId?` (set once attached), `createdAt`.
- Indexes `by_file_id`, `by_unattached_created`.

**`dishSpend`**: the daily budget.
- One row per UTC day: `day` ("2026-10-29"), `usd` (the running total), `alertedAt?`.
- Index `by_day`.

**`rateHits`**: the limiter.
- `key` (bucket + HMAC of the IP), `windowStart`, `count`.
- Index `by_key_window`. Old rows are pruned by a cron.

**Deleting data:**
- Uploads never attached to a card are deleted after an hour (nobody saved them).
- **Account deletion** (`convex/account.ts`) goes by person (V2-LINKING.md §3); `familyId` alone deletes nothing.
  - **The kid deleted** (`personId`):
    - when the card has a live `requestedOf`, it stays for her without the kid's name, voice notes or photos;
    - otherwise it goes, with its answers and files.
  - **Mom deleted** (`requestedOf`):
    - her answers, their clips and her version are deleted (her voice is hers);
    - the card stays for the kid, back to `asked`.
- Nothing else is deleted.

**IPs:** never stored as-is. Each is hashed as HMAC-SHA256(`DISH_IP_SALT`, ip).
- **Which IP:** `CF-Connecting-IP`, else the last `X-Forwarded-For` hop.
- **Checked on a Convex dev deployment, Oct 29:** HTTP routes sit behind Cloudflare, so these can't be faked.
  - Cloudflare sets `CF-Connecting-IP` itself. A request that sends its own is refused (403, Cloudflare error 1000).
  - A caller's `X-Forwarded-For` (one IP or a list) is replaced by the real address.
  - A fake `X-Real-IP` is dropped.
  - `True-Client-IP` passes through as sent, so it is never used.

## 6. Models

- **Claude** writes the guess and Mom's version, through `@anthropic-ai/sdk` with structured outputs.
  - The model is `claude-haiku-5-5` (as the MVP), and `DISH_MODEL` overrides it.
  - The guess runs with thinking off. The merge thinks, as the MVP found it needs to.
  - Each answer is checked by the ported validators and retried once with the errors.
- **Cartesia Ink** (`inkTranscribeWithKeys`) writes down the kid's voice note (English) and Mom's answers (in
  `lang`). No Gemini.
- **Translation:** `lib/translate.ts` (Claude) turns Mom's words into English when `lang` isn't `en`. Her own words
  are kept and shown first.
- **Words as data:** the dish name, the kid's words, the message and Mom's transcripts go into prompts as quoted
  data, never as instructions (as in `lib/yesNo.ts`).

**The daily budget** (Caleb, Oct 29: "keep at $10 daily budget").
- **Every paid call is counted.** Its estimated dollar cost is added to today's `dishSpend` row (UTC day), failed
  tries included:
  - **Claude:** tokens times the model's price per million.
    - `claude-haiku-5-5` costs $0.10 in and $0.50 out.
    - `claude-sonnet-5-5` costs $2 and $10.
    - `claude-opus-5-5` costs $4 and $20. This is the translation model.
    - Thinking counts as output.
  - **Cartesia Ink:** 3 credits a second, at $65 per million credits (the Pro plan's overage, the dearest rate),
    so $0.000195 a second.
    - Mom's clip uses its `durationS`.
    - The kid's voice note uses Ink's reported duration, or else bytes ÷ 4000.
- **Typical costs:** a card is about $0.001; Mom's answers cost about $0.01–0.03 with a translation.
- **The cap:** `DAILY_BUDGET_USD = 10` (`TODO(caleb)`). Once today's total reaches it:
  - **New cards are refused:** `POST /dish/cards` gives `429 rate` (§4).
  - **Mom is never cut off:**
    - `/dish/ask/answer` and `/dish/ask/finish` always take her answer.
    - Her transcription, translation and merge keep running up to an overage of `MOM_OVERAGE_USD = 1`
      (`TODO(caleb)`), so to $11 a day.
    - Past $11, her clips are saved but not sent to models. `merging` turns false, and the kid's
      `/dish/cards/get` starts the merge again the next UTC day.
- **The alert:** the first time a day reaches $10, the team is told once, through `alerts.ts` (ntfy push and
  email): "homecookd: dish budget reached". A `console.error("ALERT dish budget …")` line is logged too.
- **The check runs before each paid call**, so a few calls running at the same moment can pass the cap by
  cents.

## 7. Env (Convex)

| Name | What | Needed for |
|---|---|---|
| `ANTHROPIC_API_KEY` | already set | cards, merges, translation |
| `CARTESIA_API_KEY` (+ `CARTESIA_API_KEYS_BACKUP`) | already set | voice notes, Mom's answers |
| `DISH_IP_SALT` | new, any long random string | the IP hash; without it the limits still work with a fixed salt, and a warning is logged |
| `DISH_MODEL` | optional | overrides `claude-haiku-5-5` |

## 8. Phase 5: cravings from the app (the backend)

PRD-V2 §4 Phase 5. A parent starts in the app and asks her kids what they're craving. A kid answers on the web with
no install. It's the same dish-ask card as above, now tied to her family.

Function names and shapes match what App screens & recording codes against (`app/src/lib/cravings.ts`).

```
parent (app)  cravings.createLink → shares https://homecookd.app/miss?c=<craving token>
kid (web)     POST /dish/craving/peek → "Mom wants to know what you miss"
              POST /dish/cards {cravingToken, …} → tonight's version, plus a request to her
parent (app)  push "Caleb wants your braised pork" → cravings.forCook / cravings.get
              → "Next time you make it, tap record" (+ cravings.setFilmingDay: "Mom's filming it Sunday"), or
              → "Tell him how you make it now": cravings.sendVoiceRecipe (≤2 min voice) → her version on the kid's link
```

### Craving links

**`cravings.createLink`** (public mutation, `{sessionToken, message?}`) → `{url}`.
- Any signed-in person can make one. In practice it's the cook.
- **One live link per person, reused.** It returns her current link while it's live. A new one is made when she has
  none, when she stopped it, or when it reached its total (`CRAVING_TOTAL`).
- `message` is her line, in her voice: 1–300 characters, word-filtered. It defaults to "What do you miss from home?
  Tell me and I'll make it for you." A new `message` updates her live link's.
- The token is 22 random base62 characters. It's stored as-is, so her own link can be shown to her again, and it's
  never returned to anyone else.
- The `url` is `https://homecookd.app/miss?c=<token>`.

**`cravings.revokeLink`** (public mutation, `{sessionToken}`) → `null`. "Stop this link".
- It stops her live link from making new cards. Cards already made stay; her next `createLink` makes a new one.

**`POST /dish/craving/peek`** `{cravingToken}` → `{parentName, relation, message}`.
- `parentName` is her first name. `relation` is what the family calls her (`people.relation`, e.g. "Mom" or
  "Aaji"), or null.
- `404` for an unknown or revoked token, which counts toward the bad-token limit.

**`POST /dish/cards` with `cravingToken`**: the §4 route with one more field.
- The card is made exactly as before, with the same rules, limits and budget. On top of that:
  - `familyId` is set to her family and `requestedOf` to the person who made the link.
  - `cookClaimedAt` is set to `createdAt`: the cook side is held from the start (V2-LINKING.md).
  - `cravingId` is set to the link.
  - `relation` defaults from her `people.relation` when it maps to one of the six relations; else `mom`.
  - `kidName` is required (1–40 characters), so the push can say who's asking: `400` without it. It's
    word-filtered, as is the message.
- **Limits per link**, because the link is reusable and can be forwarded or posted:
  - at most `CRAVING_PER_DAY = 5` cards a day and `CRAVING_TOTAL = 20` in all (both `TODO(caleb)`);
  - past either, `429 rate`: "This link has had a lot of requests. Ask for a new one.";
  - the per-IP limits and the daily budget still apply.
- **A craving card never joins anyone to her family.** It only ties the card to her (`familyId`, `requestedOf`).
  Joining stays Phase 4's rule: one automatic join per side, by its ticket (V2-LINKING.md).
- **The request event:** the route schedules `internal.pushEvents.requested({askId})`, the Notifications & linking
  chat's. It picks the recipient and writes "Caleb wants your braised pork" in her language. The push opens the app at
  `/request/<askId>`.
- The kid's page still gets `askUrl`. The kid can also send the web link to anyone else.

### The parent's side (app)

```ts
type CravingAsk = {
  id: Id<"dishAsks">;            // the card; the push opens /request/<id>
  kidName: string;
  dish: string;                  // the guess's dish name
  guess: { amount: string; name: string }[];   // the guess's ingredients ("~2", "eggs")
  kidVoiceUrl: string | null;    // the kid's voice note to her
  photoUrl: string | null;       // the kid's first photo
  message: string;               // the kid's Ask Mom message
  createdAt: number;
  answered: boolean;             // her version exists
  voiceRecipe: "writing" | "ready" | "failed" | null;  // her sendVoiceRecipe, if she sent one
  filmingDay: number | null;     // 0 (Sunday) to 6, from setFilmingDay
};
```

**`cravings.forCook`** (public query, `{sessionToken}`) → `CravingAsk[]`, newest first, at most 50, answered and not.
- These are the cards made of her: `requestedOf` is her, from her craving link or a web ask she claimed in the app.

**`cravings.get`** (public query, `{sessionToken, id}`) → `CravingAsk | null`.
- It's `null` for a card that isn't hers or doesn't exist, or an `id` that isn't a card's (a deep link).
- `id`, here and in `setFilmingDay` and `sendVoiceRecipe`, is the card's id as a string.

**"Next time you make it, tap record":** the app pre-fills `/record` with the dish and the kid, and sets a weekly
local reminder ("I make it on Sundays").
- **`cravings.setFilmingDay`** (public mutation, `{sessionToken, id, day: 0–6 | null}`) → `null`. It saves the day she
  plans to film it.
  - Only `requestedOf` may set it: anyone else in her family gets "Only <name> can pick the day.", another family
    "Not found.". A day that isn't a whole number 0–6 is "Pick a day of the week.".
  - The kid's card shows "Mom's filming it Sunday": `Card.filmingDay`.
  - `null` clears it.
- When her filmed recipe is published, linking it to the card is a later step. It isn't in this spec.

**`cravings.sendVoiceRecipe`** (public **action**, `{sessionToken, id, audioId, durationS, language?}`) → `null`. "Tell
him how you make it now". The app calls it with `useAction`.
- It's an action, not a mutation, so a wrong file can be deleted while the call still fails: a mutation that throws
  keeps nothing it did, a delete included. Its work is one internal mutation (`cravings.saveVoiceRecipe`).
- **Who:** only the card's `requestedOf`. Anyone else in her family gets `ConvexError("Only <name> can answer this
  one.")`; another family's card (or none) is `ConvexError("Not found.")`, so no name leaks.
- **The audio:** uploaded first with `files.uploadUrl`.
  - Up to 2 minutes: `durationS` is 1–125, saved as at most 120.
  - The same audio types and 5 MB cap as Mom's web answers.
  - The type and size are checked from `_storage` metadata. A wrong file is deleted, and the call fails with
    `ConvexError`.
  - Only a file uploaded in the last hour is deleted: an older one may be something else's.
- **`language`:** an Ink code from §4's list, defaulting to her `people.language` or `en`.
- **It's one answer to one question.** It's saved as an answer to "How do you make it?":
  - That question is the next free kid's-own id (`q4`–`q6`), added to `asked`.
  - A second send replaces her earlier one, as a re-record does.
  - With all three own ids taken by answered questions: `ConvexError("This one already has her answer.")`.
- **Then it finishes at once,** as `/dish/ask/finish` does:
  1. Ink writes it down.
  2. Claude translates it.
  3. The same merge writes her version in her words.
  4. Her version appears on the kid's link (`/dish/cards/get`).
- **`voiceRecipe` status:**
  - `writing` until the merge lands;
  - then `ready`;
  - or `failed` when no words were heard (silence, noise) or every try failed, so she can send it again.
- The daily budget treats it like Mom's web answer: never refused, with the same $1 overage.
- **The answer event:** nothing extra here. The merge-done step schedules `internal.pushEvents.answered({askId})`
  for every card (Mom's web Send and this alike).

**The push to her** when a kid names a dish (Notifications & linking sends it, from `pushEvents.requested`):
- title: "Caleb wants your braised pork";
- body: "Caleb sent you a voice note. Tap to hear it." when the card has a voice note to her, else "See what Caleb
  guessed.";
- `data.url`: `/request/<id>`.

### Data

- **`cravingLinks`:** `familyId`, `personId` (who made it), `token`, `message`, `uses`, `createdAt`, `revokedAt?`.
  Indexes `by_token`, `by_person`.
  - `uses` counts the cards made from it. The per-day count comes from the cards, through `by_craving_created`.
- **`dishAsks`** gets more optional fields:
  - `cravingId?` (`requestedOf?`, `kidClaimedAt?` and `cookClaimedAt?` come with Phase 1, for the Phase 4 chat);
  - `filmingDay?` (0–6);
  - `voiceRecipeQ?`: the question her `sendVoiceRecipe` answers, so a second one replaces it and `voiceRecipe` can be
    worked out (a kid may ask "How do you make it?" too);
  - `familyId` is set for craving cards.
  - Indexes `by_craving_created` and `by_requested_of`; the second already exists.
- **Account deletion:**
  - deleting a person deletes their craving links;
  - deleting a family deletes its craving links (no route deletes a family yet);
  - for the cards, the Phase 1 purge rules apply (V2-LINKING.md §3): the kid's or `requestedOf`'s data goes, by person.

## 9. The cards in the app (for Phase 4's claimed links)

V2-LINKING.md: once a kid or Mom claims a card in the app, `/dish/[id]` shows it. Both are public queries with
`sessionToken`.

**`dishAsks.forMe`** `{sessionToken}` → `MyCard[]`: her cards on either side, newest first, at most 50.

**`dishAsks.get`** `{sessionToken, id}` → `MyCard | null`. It's `null` for anyone but the card's kid or cook, and for an
`id` that isn't a card.

```ts
type MyCard = Card & {        // the web's Card (§3), plus:
  id: Id<"dishAsks">;         // the push link is /dish/<id>
  side: "kid" | "cook";       // kid: personId is them; cook: requestedOf is them
  askUrl: null;               // the ask link needs the kid token, which only the web keeps
};
```
- **The kid's side:** the kid (`personId`) sees the guess, and Mom's version and clips once it's written.
- **Mom's side** (`requestedOf`): she sees the same card. Her own clips are in `answers`.

## 10. The kid shapes the card (Oct 29, from user feedback)

Three changes to the kid's routes. Nothing changes for Mom's page except what she's shown.

### No one in particular
- `relation` may be `"none"`: a dish the kid craves that isn't tied to anyone. It's accepted on `POST /dish/cards`
  and `cards/update`. A missing relation still means `mom`.
- **The guess** is a plain tonight's version, cooked by nobody in particular: the prompt says so, and no line or
  question names a cook. It still gets its 3 suggested questions, ready for when the kid picks someone.
- **Asking is off until the kid picks someone:**
  - `cards/ask` and `cards/sent` answer `400 bad_request` "Pick who you're asking first.";
  - `Card.askUrl` is null;
  - `message` is "" until a relation is picked. Then the default message is written, as on a relation change.
- `cards/update {relation: "mom"}` (or any other relation) turns asking on. Moving back to `"none"` after the card
  was sent is a `409 closed`.

### The kid picks what to ask
`cards/ask` items may carry `about`, a part of the guess:
- `{kind: "ingredient", index}`: an index into `guess.ingredients`;
- `{kind: "line", step, line}`: indexes into `guess.steps` and its `lines`.

The rules:
- **Text:** with no `text`, the server writes a short question in the kid's voice from a template. No model is
  called. The kid can reword it before sending.
  - For an ingredient: "How much <name> do you use?", with the name before any comma.
  - For a line: "How do you do this part: <line without ** marks, up to 60 characters>?"
  - With `text`, the kid's own words are used (3–120 characters, word-filtered).
- **Ids:** such a question takes the next free own id (`q4`–`q6`). It can't also carry an `id` (`400`). The guess's ingredient or line gets `ask` set to
  that id, so her answer goes where it belongs in the merge, the way `q1`–`q3` already work.
- **Caps:** the same as before, 3 open and 6 in all. An `about` that doesn't point at a part of the guess is a
  `400`.
- **Mom's page** shows them like any other question.

### The kid edits the guess
`cards/update` takes `edits`, a list of at most 20:
- `{kind: "ingredient", index, name?, amount?}`;
- `{kind: "line", step, line, text?}`.

The rules:
- **Limits:**
  - `name` is 1–80 characters and `amount` 1–40, both plain with no `**`;
  - a line's `text` is 1–80 characters as read; `**` marks are kept when paired, as in the guess.
  - Everything is word-filtered (`422 words`), and a bad index is a `400`. No model is called.
- **What changes:** an edited ingredient or line becomes `status: "stated"` (`isGuess: false`): the kid's own
  knowledge. It keeps its `ask`, so the kid can still ask about it. A line's `detail` is cleared when its text
  changes.
- **What Mom sees:** the edited guess, as "<kid> thinks…". `stated` values aren't shown as guesses. Her page's
  translation is redone, because the translation key now includes the guess.
- **Locked after Send:** once Mom has sent her answers, edits are `409 closed` (her version is built from the guess
  as it was).

### Shorter steps on the card (`short`)
Caleb: the card reads too recipe-like and wordy.
- **What:** every step line (`Line`) in the guess, Mom's version and `inLang` carries
  `short: string | null`. It's at most about 6 words (at most 40 characters as read), e.g.
  "Scramble eggs **soft**. Set aside."
- **What stays:** the full `text`, shown when the kid taps the step; and `detail`, shown for a line under it.
- **Rules,** after the app's cook-mode short steps (`pipeline/shorten.py`'s rules):
  - one action, plain words, no filler;
  - `**bold**` only around amounts, heat and times, and only ones the line's `text` gives;
  - no number, heat or time the line doesn't have.
- **Where it's written:**
  - in the same structured call as the guess and the merge, so there's no extra model call;
  - the server checks it against the line's `text` (bold and numbers), and sets it to null when it fails;
  - a line Mom changed gets her short line, checked against her words like the line itself;
  - a line the kid edits (`edits`) has its `short` cleared to null.
- **Translation:** `short` is translated with the rest of the card for her page language (`inLang`).
- **On the page:** `short` is optional; show `text` when it's null or missing.
- **Built (Oct 29).** Live, braised pork belly gave "Sear pork **medium-high**", "Simmer **15 min** covered" and
  "Ready when fork slides" for about $0.001 a card. A short line that fails the check is null; there's no retry.
