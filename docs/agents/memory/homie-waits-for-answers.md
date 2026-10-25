---
name: homie-waits-for-answers
description: "Oct 24: at the end of a recording homie waits for the cook's whole answer, never talks over her; quiet 5 s → \"still there?\", 5 s more → a kind let-off and no more questions; \"not now\" skips one"
metadata:
  type: project
---

On 2026-10-24 Caleb tried the end of a recording and said: "For the two questions that homie asks towards the end,
it doesn't wait for me to answer at all … I just start talking and then it cuts me off and then switches to the next
question … says, That's a wrap, you're done. … add like a five second silence hang before homie's like, Are you
still there? Can you answer the question? And then, if the person is still silent for another like five seconds,
homie says, That's okay. It seems like you don't want to answer today … All good, we can wrap up the dish, or
something like that. But remember, you have to give time for the person to actually respond."

**Why:** the cooks are often grandmothers in their 50s–60s, many speaking Marathi, who pause to think mid-sentence.
homie took the first speech-to-text turn (any pause) as her whole answer, asked the next question over her (and,
half duplex, stopped hearing her), and the rest of her sentence then "answered" the next question or the opt-in.
Being cut off is the opposite of the family feeling homecookd sells.

**How to apply:**
- In the wrap-up (`voice/src/record.ts` `listen`, `untilQuiet`), homie never starts a line while she talks, and an
  answer is every turn until no new words for 3.5 s (Ink 2, ink-whisper) or 4 s (Gemini Live, slower words). These
  are minimums: give time; never shorten them to make homie feel snappier without Caleb hearing it (3 s cut a 3 s
  pause in an Oct 24 live run).
- Quiet 5 s after a question finished playing → "Still there, Rajani Aaji? Take your time. I'm listening."; quiet 5 s
  more → "That's okay, Rajani Aaji. No need to answer today. All good, let's finish up." and no more questions (the
  plate photo is a tap, so it stays). Timers start when the phone has finished playing homie's line, and the phone
  plays a line only once it has all of it (~250 ms after `say_end`), never from the first chunk.
- "not now" (the card's tap, or her first words) skips only that question, at once: no nudge, no let-off. If homie
  can't hear her at all (speech-to-text showed nothing, or errored), no nudge either: just a plain wait.
- Only words she says after a question has played answer it. Talk that started before (an afterthought, family
  saying "no, beta, come and eat") never answers the next question or decides the opt-in. The let-off only ever
  follows a "still there?" she heard.
- The let-off is warm, never a guilt trip; it gives permission ("no need to answer"), never guesses her motive.
- Any new question homie asks a cook out loud (here or in a later feature) waits the same way.
- Oct 25: the wrap-up now starts with a count line and asks its questions back to back inside `{type:"hold"}`; the
  nudge and the let-off happen inside the hold ([[homie-counts-end-questions]]).
- Related: [[homie-voice]], [[homie-guidance-only]], [[in-app-recording]], [[homie-counts-end-questions]].
