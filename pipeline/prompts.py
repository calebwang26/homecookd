"""Gemini prompts (docs/HACKATHON-SPEC.md section 6) as str.format templates.

Additions to section 6: extraction times are MM:SS strings (start / end) that process.py converts to
seconds -- asked for whole seconds, gemini-3.1-pro-preview wrote 5:08 as 508 on a 15-minute clip; the
"Times:" paragraph gives the clip length; "feel" is the amount words only ("" when no amount is said --
extraction had filled it with names or adjectives like "fresh"); greetings and sign-offs are not stories;
the merge prompt's title line and its rules for uploads that show more than one dish (a phone upload or
YouTube compilation may hold several); one ingredient entry per distinct use (feels were being joined and
estimates summed across uses); step grouping by technique, ~90 s per step, with times from the first to the
last step event; its "Format rules" and its sessions/events blocks, and the two retry suffixes that feed
validation errors back. Completeness (no step left out): the extraction's "Steps come first" rules, the merge's
"Keep every step" rule (grouping keeps every action; no step limit), and COVERAGE_RETRY_SUFFIX, which
process.ensure_coverage adds when pipeline/coverage.py finds extracted steps that no recipe step covers.
Language: the cook may narrate in Marathi, English or a mix. Extraction translates every text field into
English (the app, cook mode and the English-only Moss index read them) and keeps the spoken Marathi of each
quote in quote_original; the merge carries it, and align hears the Marathi but reads the English. Another
language (Oct 24): language_line points the same rules at her language and its script.
Oct 24 (Track F): {context} is the job's language line (language_line) plus, when homie (the AI helper that
talks to the cook while she films) was there, its questions and her answers (homie_block), so homie's voice is
never taken for the cook's. Glasses through the laptop bridge (glasses/BRIDGE.md) add live_block: what the live
pass saw while she cooked, as hints to check against the video, and the spans the video has no footage for. Steps are grouped more coarsely: about 8 to 12 for a typical home dish.

EXTRACT_PROMPT.format(i=..., n=..., clip_mmss=..., context=...)
EXTRACT_RETRY_SUFFIX.format(error=...)
MERGE_PROMPT.format(n=..., title=<json string>, duration_s=..., sessions=<json>, events=<json>, context=...)
MERGE_RETRY_SUFFIX.format(errors=..., previous=<json>)
COVERAGE_RETRY_SUFFIX.format(missing=<"- start-end s: action" lines>, previous=<json>)
ORDER_PROMPT.format(n=..., title=<json string>, dates=<text>, clips=<text>)   (pipeline/order.py; text only, cheap model)
SHORTEN_PROMPT.format(recipe=<json>)   (pipeline/shorten.py: cook mode's short substeps, step ingredients, tips)
SHORTEN_RETRY_SUFFIX.format(errors=..., previous=<json>)
ALIGN_PROMPT.format(title=<json string>), ALIGN_STEP.format(...), ALIGN_RETRY_SUFFIX.format(errors=...)
ALIGN_TRANSCRIPT_PROMPT.format(title=...), ALIGN_TRANSCRIPT_STEP.format(..., lines=...)   (ALIGNER=claude: the
    step's transcript lines instead of its audio clip)
    (pipeline/align.py: when each substep starts in its step's audio clip; clip times are MM:SS like extraction's)
COVER_PROMPT.format(title=<json string>, clip_mmss=..., step_span=...)
    (pipeline/cover.py: the second in the video's last minutes where the finished dish looks best, the cover photo,
    and the second inside the last step where it shows best, that step's still)
COVER_BOX_PROMPT.format(title=<json string>)   (pipeline/cover.py: the dish's box in the cover frame, to crop to)
COVER_FRAMES_NOTE.format(n=..., every=...)   (pipeline/cover.py, COVER_PROVIDER=claude: before COVER_PROMPT)
"""

EXTRACT_PROMPT = """\
You are watching a first-person video of a home cook making a family dish.
The cook may narrate in Marathi, in English, or in a mix of the two (switching mid-sentence, or
Marathi with English words). This clip is file {i} of {n} of the recording.
{context}
Return every STEP, STORY and SPECIAL moment in this clip as JSON matching the schema.

Steps come first: the family will cook from them, and one missing step can ruin the dish.
- Return EVERY step, including short or obvious ones: washing, peeling, chopping, measuring,
  preheating the oven or pan, adding oil, seasoning, stirring something in, tasting, covering,
  flipping, draining, resting, plating and garnishing.
- Start a new step whenever the cook does something new to the food or adds an ingredient.
- Never skip a step because it is short, obvious, or done without a word.
- Cover the whole clip from 00:00 to {clip_mmss}: the first and last minutes as carefully as the middle.

For each step:
- start / end: timestamps from the start of THIS clip as MM:SS (e.g. "05:08"), covering the action.
- action: one short imperative sentence.
- ingredients added: name; "feel" = the cook's words for the AMOUNT only (e.g. "two big scoops",
  "a little touch"), or "" (empty) if she says no amount. Never put the ingredient's name or a
  description ("garlic", "fresh", "your eggs") in feel.
  "estimate" = your best US/metric estimate from what you SEE (hand size, spoon,
  pan, packaging), prefixed with "~", or "unknown" if you cannot see it.
- sensory_cue: what the cook looks, listens or smells for, in her words if she says it.
- quote: what she says during the step, in her words (in English: see Language below).
- quote_original: see Language below.

For each story (people, places, memories, why the dish matters):
- start / end (MM:SS) and text. Keep her voice; do not summarise: tell it all, in English.
  Greetings, sign-offs and calls to like or subscribe ("bye bye", "see you next time") are not stories.

For each special moment (a technique, ingredient or order that differs from how
this dish is usually made): start / end (MM:SS), text, and why it is unusual.

Language: write every text field (action, ingredient name, feel, sensory_cue, quote, story and special
text, why) in natural, plain English, even when the cook speaks Marathi. Translate faithfully: keep her
meaning, her homely phrases and her amounts ("a fistful", "until it smells nutty", "two small spoons"),
not a word-for-word gloss, and add nothing she did not say. Give ingredients their common English names
("turmeric", "mustard seeds"); when one has none, use the name she says in Latin letters ("kokum",
"goda masala"). Never write Devanagari or romanised Marathi sentences in these fields.
quote_original: when she says the quote in Marathi, in whole or in part, her exact words as spoken, in
Devanagari (English words she says stay in English); null when she speaks only English or says nothing.

Rules: never invent ingredients or amounts you did not see or hear.
Ignore silence, off-topic talk and idle waiting while nothing happens to the food (starting a
rest, simmer or bake is still a step). If an action continues past the end of the clip, end it
at the clip's last second.

Times: this clip is {clip_mmss} long. Every start and end is an MM:SS timestamp between 00:00
and {clip_mmss}, with start before end; use the clip's own timeline, not any clock shown on screen.
"""

# ISO 639-1 codes the app offers (app/src/lib/languages.ts); any other code is named as itself.
LANGUAGES = {
    "en": "English", "mr": "Marathi", "hi": "Hindi", "bn": "Bengali", "gu": "Gujarati", "kn": "Kannada",
    "ml": "Malayalam", "pa": "Punjabi", "ta": "Tamil", "te": "Telugu", "ur": "Urdu", "zh": "Mandarin Chinese",
    "es": "Spanish", "fr": "French", "de": "German", "pt": "Portuguese", "ja": "Japanese", "ko": "Korean",
    "it": "Italian", "ru": "Russian", "ar": "Arabic", "tr": "Turkish", "vi": "Vietnamese", "tl": "Tagalog",
    "id": "Indonesian", "th": "Thai", "pl": "Polish", "uk": "Ukrainian", "ms": "Malay", "or": "Odia",
}


# The script each language is written in, for quote_original. Not listed: the Latin alphabet (Spanish, Tagalog, …).
SCRIPTS = {
    "mr": "Devanagari", "hi": "Devanagari", "bn": "Bengali script", "gu": "Gujarati script", "kn": "Kannada script",
    "ml": "Malayalam script", "pa": "Gurmukhi", "ta": "Tamil script", "te": "Telugu script", "ur": "Urdu script",
    "or": "Odia script", "zh": "simplified Chinese characters", "ja": "Japanese script", "ko": "Hangul",
    "ar": "Arabic script", "ru": "Cyrillic", "uk": "Cyrillic", "th": "Thai script",
}


def language_line(code: str | None) -> str:
    """The job's language as prompt lines ("" when the job doesn't say).

    The prompts' Language rules name Marathi and Devanagari; for any other language these lines apply them to
    hers (Oct 24), so her script stays out of the English fields and goes into quote_original. Marathi's line
    and every prompt body are unchanged.
    """
    if not code:
        return ""
    if code == "en":
        return "The family says the cook narrates in English.\n"
    name = LANGUAGES.get(code, code)
    line = (f"The family says the cook narrates in {name}, maybe mixed with English. "
            "Translate it as the Language rules below say for Marathi.\n")
    if code == "mr":
        return line
    script = SCRIPTS.get(code)
    words = f"{script} or romanised {name} sentences" if script else f"{name} sentences"
    return line + (f"Wherever those rules say Marathi, read {name}, and for Devanagari read {script or 'the Latin alphabet'}: "
                   f"never write {words} in the English fields, and "
                   f"write quote_original as her exact {name} words{f', in {script}' if script else ''} "
                   "(English words she says stay in English).\n")


HOMIE_BLOCK = """\
homie (an AI helper on a phone nearby) asked the cook these questions at these times; its voice is in the
audio. Never quote homie as the cook, and never take a step, amount, story or tip from what homie said.
The cook's answer right after a question is her narration for that step. Start a step at the cook's
answer (or at the action), not at homie's question.
{lines}
"""


def homie_block(log: list[dict] | None, base_s: float = 0, clip_s: float | None = None) -> str:
    """homie's questions and the cook's answers for a prompt. Times in `log` are seconds on the video's
    clock; base_s/clip_s make them MM:SS within one clip (extraction), otherwise whole seconds (merge)."""
    def at(t: float) -> str:
        if clip_s is None:
            return f"{round(t)} s"
        s = max(0, round(t - base_s))
        return f"{s // 60:02d}:{s % 60:02d}"

    lines = []
    for e in log or []:
        if clip_s is not None and not 0 <= e["atS"] - base_s <= clip_s:
            continue
        said = e.get("textEn") or e.get("text") or ""
        original = e.get("text")
        line = f'- {at(e["atS"])} homie asked ({e.get("kind", "question")}): "{said}"'
        if original and original != said:
            line += f' (spoken as "{original}")'
        if a := e.get("answer"):
            words = a.get("transcriptEn") or a.get("transcript") or ""
            line += f'; the cook answered {at(a["atS"])}-{at(a["endS"])}: "{words}"'
        lines.append(line)
    return HOMIE_BLOCK.format(lines="\n".join(lines)) if lines else ""


LIVE_BLOCK = """\
A quick live pass watched this recording in 30-second pieces while the cook was cooking. These are its
notes. They are hints, not facts: use them to notice things, but take every step, amount, quote and time
from the video itself, and where the video and a note disagree, the video is right. "marker" notes are the
cook's own button presses on her glasses when she started something new: likely step boundaries.
{lines}{missed}{gaps}"""

LIVE_MISSED = """The live pass did not look at {spans}; the video there is complete, so read it as usual.
"""

LIVE_GAPS = """The video has no footage at {spans} (a frozen frame and silence: the glasses lost those
seconds). Never invent steps there. If a live note above falls in one of those spans, it is the only record
of that moment: keep it, as a low-confidence step if it is a step, and keep its time.
"""


def live_block(live: dict | None, base_s: float = 0, clip_s: float | None = None) -> str:
    """The laptop bridge's live analysis (Convex /worker/claim's liveLog, liveGaps, videoGaps; video seconds)
    for a prompt. base_s/clip_s keep one clip's part and make it MM:SS within it (extraction); otherwise
    whole seconds (merge)."""
    live = live or {}

    def at(t: float) -> str:
        if clip_s is None:
            return f"{round(t)} s"
        s = max(0, round(t - base_s))
        return f"{s // 60:02d}:{s % 60:02d}"

    def inside(t0: float, t1: float) -> bool:
        return clip_s is None or (t1 >= base_s and t0 <= base_s + clip_s)

    def spans(items: list[dict]) -> str:  # cut to the clip; a span that only touches its edge isn't in it
        lo, hi = (base_s, base_s + clip_s) if clip_s is not None else (float("-inf"), float("inf"))
        return ", ".join(f"{at(max(g['startS'], lo))}-{at(min(g['endS'], hi))}" for g in items
                         if g["endS"] > lo and g["startS"] < hi)

    lines = []
    for e in live.get("liveLog") or []:
        if not inside(e["atS"], e.get("endS", e["atS"])):
            continue
        when = at(e["atS"]) + (f"-{at(e['endS'])}" if e.get("endS") is not None else "")
        line = f"- {when} {e['kind']}: {e['title']}"
        if e.get("text"):
            line += f": {e['text']}"
        if e.get("saidAs"):
            line += f' (said "{e["saidAs"]}")'
        if e.get("quoteOriginal"):
            line += f' (spoken as "{e["quoteOriginal"]}")'
        lines.append(line)
    missed, gaps = spans(live.get("liveGaps") or []), spans(live.get("videoGaps") or [])
    if not lines and not gaps:
        return ""
    return LIVE_BLOCK.format(lines="\n".join(lines) + "\n" if lines else "(no notes for this part)\n",
                             missed=LIVE_MISSED.format(spans=missed) if missed and lines else "",
                             gaps=LIVE_GAPS.format(spans=gaps) if gaps else "")


def context(language: str | None, log: list[dict] | None, base_s: float = 0, clip_s: float | None = None,
            live: dict | None = None) -> str:
    """{context} for EXTRACT_PROMPT and MERGE_PROMPT: "" for a plain upload, so the prompts stay as before."""
    return language_line(language) + homie_block(log, base_s, clip_s) + live_block(live, base_s, clip_s)


EXTRACT_RETRY_SUFFIX = """\

Your previous answer was rejected: {error}
Return the complete answer again with that fixed.
"""

MERGE_PROMPT = """\
You are given events extracted from {n} consecutive files of one cooking recording,
with timestamps already converted to seconds from the start of the full video,
plus the recording sessions with their real-world start times.
The family titled this recipe {title}.

The cook may have spoken Marathi, English or a mix; every event's text is already in English, and an
event's quote_original holds the cook's Marathi words for its quote.
{context}
Produce one recipe matching the recipe schema:
- Build the recipe for the dish named in the title. If the events clearly cover other, separate dishes
  (e.g. a compilation video), leave their steps, ingredients, stories and special moments out. Parts of
  the same meal made for this dish (a sauce, a garnish, rice to serve it with) are not separate dishes,
  and a family name that names no food (e.g. "Sunday Special") matches the main dish.
  If the title matches none of the dishes, build the recipe for the main dish shown and make the first
  follow_up_question say so (e.g. "This video seems to show X rather than Y. Which should we keep?").
- Keep every step. Every step event in the input must end up in the recipe, as its own step or inside a
  grouped step (below) whose start_s..end_s covers its time and whose instruction says it. Never drop a
  step to make the recipe shorter, and never drop one for being short or obvious (preheating, seasoning,
  stirring something in, resting, plating).
- Merge step events only when they are the same action: one action split across a file boundary, or the
  same action listed twice. If unsure whether two step events are the same action, keep both.
- Merge repeated mentions of the same ingredient; sum estimates only if they are clearly separate
  additions for the same use. If an ingredient serves clearly different purposes in different amounts
  (water for boiling the rice, water for the saffron milk), give each use its own entry named with the use,
  e.g. "water (for boiling the rice)"; otherwise keep one entry with the main addition's feel and estimate.
  Never join several feels into one string, and never add estimates together across different uses.
- List only raw ingredients (what you would buy or take from the pantry), not things made in an earlier
  step (e.g. a paste, marinade or sauce made earlier, the marinated meat, the cooked rice). Leave out
  water used only to test a pan's heat or for an ice bath.
- Order steps by start_s and number them from 1.
- Make each step one technique or one small component: group consecutive actions that are the same
  technique or finish one small component (e.g. cut, scoop and mash the potatoes; roast, grind and stir
  in the cumin), and keep different techniques apart (mixing the dough and shaping it are two steps).
  Grouping keeps every action: a grouped step's instruction names each one.
  Aim for about 8 to 12 steps for a typical home dish: each step one stage the family would name ("make
  the masala", "fry the onions until golden", "layer and steam the rice"), usually one to three minutes of
  video. Go beyond 12 only for a long or busy video with clearly separate stages, and never by dropping
  an action: fold short actions (adding salt, a stir, a taste) into the stage they belong to.
  A grouped step's start_s is the start_s of its first step event and its end_s the end_s of its last
  step event (not stretched over intro talk, stories or b-roll around them); its quote is the cook's
  most useful words from those actions, verbatim; its sensory_cue keeps every cue.
- Write every text field in English; never Devanagari. A step's quote_original is the input's quote_original
  for the words its quote uses, copied exactly (joined with a space, in order, when the quote joins several
  events); null when those events' quote_original are all null.
- Write each instruction so someone who never saw the dish could follow it.
  Keep sensory cues; they matter more than times.
- Attach each story and each special moment to the step it happened during or nearest to.
  Stories are about people, places, memories or why the dish matters: leave out greetings, sign-offs and
  calls to like or subscribe ("bye bye", "see you next time") even if the input lists them as stories.
- Keep only the 2 to 3 strongest special moments.
- Write the intro from the stories in 1 to 2 sentences.
- Set wait_after on the last step before a gap between sessions (e.g. "overnight, ~10 hrs").
- List 3 to 5 warm follow_up_questions about real gaps: an amount marked unknown,
  a step with no clear end cue, an ingredient seen but never added.
Do not add steps, ingredients, stories or special moments that are not in the input.

Format rules (the output is validated; breaking one rejects the whole recipe):
- Every ingredient's "feel" is copied verbatim from the input; never replace it with the estimate.
  "feel" holds the cook's amount words only ("a nice spoon", "two scoops"). If the input feel is not an
  amount (the ingredient's name, or a description such as "fresh", "fresh garden" or "leftover"), write ""
  (empty) as the feel and put nothing in its place.
- "estimate" starts with "~" or is exactly "unknown". "confidence" is low, medium or high.
  Take estimates from the input only: if the input estimate is "unknown", keep "unknown" with low confidence.
- Every story and special has a unique id (s1, s2, ... for stories; x1, x2, ... for specials)
  and a "step" equal to the order number of the step it is attached to.
- A special's end_s may be null.
- Follow-up question ids are q1, q2, ...; about_step is a step order number or null.
- All times are whole seconds within 0..{duration_s}, and start_s < end_s for every step,
  story and special (widen a momentary event to at least 1 second).

The full video is {duration_s} seconds long.

Recording sessions (offset_s = where the session starts in the full video; gap_before_min =
real-world minutes between the end of the previous session and the start of this one):
{sessions}

Events (type, start_s, end_s in seconds from the start of the full video):
{events}
"""

MERGE_RETRY_SUFFIX = """\

Your last answer was rejected by the validator with these errors:
{errors}

Your last answer:
{previous}

Return a corrected recipe that fixes every error above and follows all the rules and instructions above.
"""

COVERAGE_RETRY_SUFFIX = """\

Your first recipe left out these step events from the input (its steps do not cover their time):
{missing}

Your first recipe:
{previous}

Return the complete recipe again with every step above included: as its own step, or inside the step it
belongs to (widen that step's start_s..end_s to cover it and name the action in its instruction). Keep
everything else the same, renumber the steps by start_s, and keep each story, special and follow-up
question pointing at the same step as before. Leave a step out only if it belongs to a separate dish,
not the one named in the title.
"""

ORDER_PROMPT = """\
These {n} video clips were filmed by one home cook making the dish the family titled {title}.
They came from a phone's camera roll, listed below by file date. File dates: {dates}.
If the file dates look consistent, keep their order unless the clips clearly happened in another order.

Decide the order the clips happened in while cooking. Cooking usually goes: setup and prep (preheating,
washing, chopping, measuring, marinating, mixing dry ingredients), then mixing, cooking and assembling
(frying, boiling, simmering, baking), then plating and serving. Also use what the cook says
("now that it has rested", "next we will..."). Keep a clip with no steps where it is.

Return:
- order: every clip id exactly once, the first clip first.
- confidence: "high" only if what happens in the clips makes the order clear; "medium" if it is likely;
  "low" if the clips could go in more than one order or you are guessing from the file dates.
- reason: one short sentence.

Clips (times are from the start of each clip):
{clips}
"""

SHORTEN_PROMPT = """\
This family recipe is cooked from a phone, one step per screen, often by a kid or a beginner. Each step
screen shows the step's video, its title, a few short lines to follow, the ingredients the step needs and
sometimes one tip. Rewrite every step for that screen. Clarity beats completeness: short, plain words.

For every step, return its "order" and:

substeps: 2 to 5 lines, in the order the cook does them.
- text: an imperative of at most 10 words and 70 characters, in plain English with its little words
  kept ("Crush the garlic with the flat of a knife.", not "Crush garlic with knife."). Keep "about"
  on amounts and times. Put **double asterisks** around each amount, heat level and time ("Simmer on
  **low** for **about 3 hours**."). Bold nothing else, and bold only the recipe's own words ("up **a
  little bit**" when the recipe says "a little bit"; never a new word like "slightly"). No technical
  terms: a 12-year-old must understand the line without its detail ("Ready when **a drop of water
  dances** on the pan.", never "the Leidenfrost effect").
- detail: shown in the line's place when the cook taps it: the line's fuller version, taken from the
  step's instruction or sensory_cue with their wording kept, written as whole sentences (a capital
  letter, a full stop). Only when it adds a few words the line leaves out (a how, a why, a cue);
  otherwise null. Most lines need none. A detail only fills out its own line: every action the cook
  takes goes in a line of its own, never only in a detail or the tip.
- Together the lines cover everything the instruction says to do. Never add an action it does not say.
- When the sensory_cue says how you can tell the step is done, add a line "Ready when **...**" with the
  cue cut to a few words (keep what makes it a test: "you can see your hand's shadow through it", not
  "you can see a shadow"), and put the full cue in its detail. It goes right after the action it
  checks, which is usually the last one.

uses: every recipe ingredient this step needs, including ones used again from an earlier step (the
garlic chopped in step 3 going into the butter in step 7). Leave out what the step does not touch, and
things made in an earlier step (a glaze, a dough): they are not in the ingredient list.
- name: copied character for character from the recipe's ingredient list.
- amount: a measurement, never the cook's loose words ("a splash", "a pinch", "a little bit" stay in
  the lines): the measured amount or share this step uses if the step's own text gives one ("2 tbsp",
  "half"), otherwise the ingredient's estimate exactly as listed. null when the estimate is "unknown",
  null for an ingredient an earlier step already added or prepared (the butter already in the pan),
  and null when the ingredient is split across steps and this step gives no measured share (the
  estimate is the whole recipe's).
- Leave out water used only to test a pan's heat or for an ice bath.

tip: one short, practical tip (at most 20 words) that would genuinely help a beginner on this step: what
to watch for, a mistake to avoid, or a why that changes what you do. Take it from the cook's own words in
the step's quote, its special moments or its sensory_cue and keep the cook's voice, minus filler words
("like", "um", "you know", "so basically"). Keep what the cook means: never correct, reverse or
second-guess the cook (a special moment's "why" says why it is unusual; it is not a reason to doubt it),
and give no tip when the cook's words are unclear or wrong as cooking advice. Never a story, a slogan or
a joke, never something one of the step's lines or details already says (its "Ready when" line
included), and never an action the lines leave out. null for most steps: at
most one step in three has a tip, and fewer is better.

Rules (the answer is checked, and breaking one rejects it):
- Never invent an amount, temperature, heat level, time or ingredient the recipe does not give. Every
  number comes from the recipe's own text; number words may become digits ("three hours" -> "3 hours").
- No placeholders or questions anywhere: no square brackets, no "ask Dad", no "TBD", no "unknown",
  no "..." or "…" (when the cook trails off, end the sentence instead).
- One entry per step, with the recipe's own order numbers.

Recipe (JSON):
{recipe}
"""

SHORTEN_RETRY_SUFFIX = """\

Your last answer was rejected by the checker with these errors:
{errors}

Your last answer:
{previous}

Return the complete answer again with every error above fixed, following all the rules above.
"""


ALIGN_PROMPT = """\
You are listening to a home cook narrating while cooking {title}. The cook may speak Marathi, English or a
mix of the two. Below, each recipe step comes with an audio clip of exactly that step: the clip starts at the
step's first second. Each step lists its short substeps in order (in English), and what the cook says during
the step: in English, followed by the words as spoken when the cook spoke Marathi.

For every substep, give the time in its step's clip (MM:SS from the start of THAT clip) where the cook begins
that substep: where they start doing it or start talking about it. Go by what they say, in any language,
and by sounds like sizzling, chopping, pouring or whisking.

Rules:
- The first substep of every step is 00:00.
- Within a step, times strictly increase in the order the substeps are listed and stay below the clip's length.
- A "Ready when ..." line starts where the cook checks for, or describes, that cue.
- If you cannot hear where a substep starts, place it between its neighbours where it most likely happens.
- Return one entry per step listed below (by its order number) with exactly one time per substep.
"""

ALIGN_STEP = """\
Step {order}: {title}. Clip length {clip_mmss}.
Substeps:
{substeps}
What the cook says: {quote}
Audio clip of step {order}:"""

# ALIGNER=claude (pipeline/align.py): Claude takes no audio, so it times the substeps on the step's transcript lines.
ALIGN_TRANSCRIPT_PROMPT = """\
You are timing the substeps of a home recipe, {title}, on the cook's recording. The cook may speak Marathi,
English or a mix of the two. Below, each recipe step lists its short substeps in order (in English), what the
cook says during the step (in English, followed by the words as spoken when the cook spoke Marathi), and a
speech-to-text transcript of the step: each line starts with its time, MM:SS from the start of THAT step. The
transcript can have spelling slips, words in the wrong script and missing words: read it as speech.

For every substep, give the time in its step (MM:SS from the start of THAT step) where the cook begins that
substep: where they start talking about it or doing it. Go by the transcript lines' times.

Rules:
- The first substep of every step is 00:00.
- Within a step, times strictly increase in the order the substeps are listed and stay below the step's length.
- A "Ready when ..." line starts where the cook checks for, or describes, that cue.
- If the transcript doesn't show where a substep starts, place it between its neighbours where it most likely
  happens.
- Return one entry per step listed below (by its order number) with exactly one time per substep.
"""

ALIGN_TRANSCRIPT_STEP = """\
Step {order}: {title}. Step length {clip_mmss}.
Substeps:
{substeps}
What the cook says: {quote}
Transcript of step {order}:
{lines}
"""

ALIGN_RETRY_SUFFIX = """\

An earlier answer for these steps was rejected:
{errors}
Answer again for the steps below only, following all the rules above.
"""

COVER_PROMPT = """\
This is the end of a home video of a cook making {title}. The clip is {clip_mmss} long. We need the recipe's
cover photo: one real frame from this clip, which we crop tightly to the dish and show big on the family's phones.

Find the moment, anywhere in the clip, where the FINISHED dish itself looks best: cooked, and ideally served on
a plate or in a bowl, with all its garnish on. Because we crop to the dish, what else is in the frame (people,
jars, the counter) doesn't matter. What matters: the dish is as BIG in the frame as it gets (close to the
camera), in focus, well lit, seen whole, and not hidden by hands, a spoon, steam or a lid. Food still cooking in
the pan counts only if the finished dish is never shown served. Never pick a closed container or a raw ingredient.

Return found = true and at = the MM:SS time in THIS clip (from 00:00) of that moment. If the finished dish is
never clearly visible, return found = false and at = "00:00".

The recipe's last step is {step_span}. Its photo is shown while the family cooks that step.
Separately, step_at = the MM:SS time in THIS clip, inside that span only, where the finished dish shows best (the
same rules; this one is shown uncropped, so the dish should read well in the whole frame), or "" if it isn't
visible inside that span. at and step_at may be the same moment if that is the best one for both.
"""

# Claude takes no video (pipeline/cover.py grab_frames): this goes before COVER_PROMPT with the clip as stills.
COVER_FRAMES_NOTE = """\
The clip comes as {n} still frames, one every {every} seconds, each after a line giving its MM:SS time in the
clip. Every time you return (at, step_at) must be one of those frames' times.

"""

COVER_BOX_PROMPT = """\
This frame is the cover photo of a home recipe for {title}. Find the finished dish in it: the plate, bowl or pan
of food, with its whole rim and any garnish, and nothing else (not the hands, other dishes, jars or people).
Return found = true and box_2d = [ymin, xmin, ymax, xmax], each a whole number from 0 to 1000 as a share of the
image's height (y) or width (x). If no finished dish is in the frame, return found = false and box_2d = [0, 0, 0, 0].
"""
