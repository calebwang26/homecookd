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
| 429 | `rate` | over a limit, or today's model budget is spent (the sentence says which, and to try again later) |
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
type Relation = "mom" | "dad" | "grandma" | "grandpa" | "auntie" | "uncle";
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
  asked: Question[];          // what Mom is asked, in order (0–6)
  message: string;            // the Ask Mom message, in the kid's voice, editable
  kidVoiceUrl: string | null; // the kid's voice note to Mom (a Convex storage URL)
  photoUrls: string[];        // the photos the card was made from (0–3)
  askUrl: string;             // https://homecookd.app/a?t=<ask token>
  askedAt: number | null; openedAt: number | null; finishedAt: number | null; // ms since epoch
  createdAt: number;
};
type Answer = { id: QuestionId; words: string; english: string | null; audioUrl: string | null; durationS: number };

type Ask = {                  // what Mom's page gets; never the kid token
  dish: string; relation: Relation; kidName: string | null;
  message: string; kidVoiceUrl: string | null;
  guess: Recipe;              // the kid's guess, shown as theirs
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

**`POST /dish/cards/update`** `{kidToken, relation?, kidName?, message?, voiceNote?: fileId | null}` → `{card}`
- `message`: 1–500 characters after trimming, word-filtered. This is the Ask Mom text.
- `voiceNote`: the kid's voice note *to Mom*. It is played first on her page and isn't sent to any model; `null`
  removes it. A new one replaces and deletes the old file.
- A voice note for Mom may be at most 60 s. The web enforces this; the server only checks the 3 MB cap.
- Once Mom has finished, `message` and `voiceNote` give `409 closed`.

**`POST /dish/cards/ask`** `{kidToken, questions: [{id?, text}]}` → `{card}`
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

**`POST /dish/ask/peek`** `{askToken}` → `{ask}`
- Sets `openedAt` the first time.
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
  `kidVoiceNote?: Id<"_storage">` (to Mom).
- **The guess:** `guess` (Recipe), `message`, `asked: Question[]`.
- **Mom's side:** `version?` (Recipe), `status`.
- **Merge state:** `mergeTries`, `mergeStartedAt?`, `mergedAt?`.
- **Funnel times:** `askedAt?`, `askedVia?`, `openedAt?`, `finishedAt?`, `questionsAt?`, `genMs`, `createdAt`.
- **Who:** `ipKey` (an HMAC of the IP, for the limits), plus `familyId?` and `personId?` for when someone signs in
  (Phase 4).
- **Indexes:** `by_kid_token`, `by_ask_token`, `by_family`, `by_person`.

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
- Account deletion (`convex/account.ts`) deletes the cards whose `familyId` or `personId` is the deleted family or
  person, and their answers and files.
- Nothing else is deleted.

**IPs:** never stored as-is. Each is hashed as HMAC-SHA256(`DISH_IP_SALT`, ip), with the IP taken from
`X-Forwarded-For`'s first entry.

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
