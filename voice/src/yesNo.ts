// The kid's spoken yes or no: an answer to homie's offers (read it out loud, hear a story) and to the app's own
// homie moments. The app's yesNo (app/src/lib/live/voiceLogic.ts) must decide the same words the same way, so
// this file has no imports and can be copied there as it is.
//
// - A reply that starts with a yes or a no counts, whatever follows: "Sure, read it.", "No, not right now.",
//   "Nah, I'm good.", "Don't.". A no wins: "Okay, no." is a no.
// - "Okay", "alright" and "please" count alone, or before a yes or a no. Kids start every kind of sentence with
//   them, so "Okay, what's the next step?", "Okay, set a timer" and "Please go back" are not a yes.
// - "Not yet", "later", "maybe later" and "skip it" count only as the whole reply: "Not yet sure how much salt" is
//   a question.
// - A yes is a yes even with a question after it ("Yes, but how much ginger?"): the app takes it as its moment's
//   yes too, and the kid can ask again.
// - "No problem", "no worries", "no idea", "don't know", "don't understand" and "oh no" are not a no.

const YES = /^(yes|yeah|yep|yup|sure|of course|go ahead|do it|play it|read it|let'?s hear it)\b/;
const NO = /^(no(?! (problem|worries|idea)\b)|nah|nope|don'?t(?! (know|understand)\b)|not now|not right now|not really|i'?m good)\b/;
const WHOLE_NO = /^(not yet|later|maybe later|skip it)$/;
const OPENERS = /^((ok|okay|alright|all right|please)( |$))+/;
const FILLERS = /^((um|uh|oh(?! no\b)|ah|hmm|mm|well|wait|so|hey|and|now) )+/;

export function yesNo(text: string): "yes" | "no" | null {
  const reply = text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z' ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(FILLERS, "")
    .replace(/( (please|thanks|thank you))+$/, "");
  const rest = reply.replace(OPENERS, "").replace(FILLERS, "");
  if (NO.test(rest) || WHOLE_NO.test(rest)) return "no";
  if (YES.test(rest) || (reply && !rest)) return "yes";
  return null;
}
