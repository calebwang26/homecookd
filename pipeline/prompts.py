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
quote in quote_original; the merge carries it, and align hears the Marathi but reads the English.

EXTRACT_PROMPT.format(i=..., n=..., clip_mmss=...)
EXTRACT_RETRY_SUFFIX.format(error=...)
MERGE_PROMPT.format(n=..., title=<json string>, duration_s=..., sessions=<json>, events=<json>)
MERGE_RETRY_SUFFIX.format(errors=..., previous=<json>)
COVERAGE_RETRY_SUFFIX.format(missing=<"- start-end s: action" lines>, previous=<json>)
ORDER_PROMPT.format(n=..., title=<json string>, dates=<text>, clips=<text>)   (pipeline/order.py; text only, cheap model)
SHORTEN_PROMPT.format(recipe=<json>)   (pipeline/shorten.py: cook mode's short substeps, step ingredients, tips)
SHORTEN_RETRY_SUFFIX.format(errors=..., previous=<json>)
ALIGN_PROMPT.format(title=<json string>), ALIGN_STEP.format(...), ALIGN_RETRY_SUFFIX.format(errors=...)
    (pipeline/align.py: when each substep starts in its step's audio clip; clip times are MM:SS like extraction's)
"""

EXTRACT_PROMPT = """\
You are watching a first-person video of a home cook making a family dish.
The cook may narrate in Marathi, in English, or in a mix of the two (switching mid-sentence, or
Marathi with English words). This clip is file {i} of {n} of the recording.

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
  A step usually covers under ~90 s of video unless it is one continuous action (e.g. frying onions for
  2 minutes). There is no maximum number of steps: a long or busy video simply has more.
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

ALIGN_RETRY_SUFFIX = """\

An earlier answer for these steps was rejected:
{errors}
Answer again for the steps below only, following all the rules above.
"""
