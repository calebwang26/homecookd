// The kid's spoken yes or no: an answer to homie's offers (read it out loud, hear a story) and to the app's own
// homie moments. It follows the app's yesNo (app/src/lib/live/voiceLogic.ts, #36) and adds the everyday no's
// that come with more words after them. No imports.
//
// - A yes word counts, whatever follows: "Sure, read it.", "Yes, I want to hear it.", and "Yes, but how much
//   ginger?" (decided: a yes, as in the app; the kid can ask again).
// - "Okay", "ok", "alright" and "please" count with any words after them ("Please do.", "Okay, let's do it."),
//   unless a command or a question follows: "Okay, what's the next step?", "Okay, set a timer for 5 minutes" and
//   "Please go back" go the usual way.
// - A no counts, whatever follows ("No, not right now.", "Nah, I'm good.", "Don't.", and "No, it's fine.", decided),
//   and wins after a yes or an okay: "Okay, no." and "Yeah, no, I'm good." are a no. What the kid says after the no
//   is still theirs (afterNo): a question ("No, the oil's too hot?"), a command ("No, go to step 3.", "No, play the
//   video.") or 3+ words ("No, I'm out of ginger. Can I skip it?"), unless it's just more no ("No, maybe later.",
//   "Nah, I'm good for now.", "No, don't read it.", "No, no need to read it.", "No, I got it."). A mixed signal
//   goes on as said: "No, just read it." declines the offer and passes "read it" on (to Claude).
// - "Not yet", "not really", "later", "maybe later", "skip it" and "I'm good" count only as the whole reply, and
//   "don't" alone or before read, play, do, bother, want or need: "Not really sure how much salt", "I'm good at
//   this" and "Don't forget the timer" are not a no.
// - Not a no: "no problem", "no worries", "no idea", "no clue", "no one", "nobody", "don't know", "don't
//   understand", and "oh no" unless a no follows it ("Oh no, I burned it!", but "Oh, no thanks." is a no).

const FILLERS = /^((um|uh|oh|ah|hmm|mm|well|wait|so|hey|and|now|but) )+/;
const OH_NO = /^((um|uh|ah|hmm|mm|well|wait|so|hey|and|now|but) )*oh no\b/;
/** Yes words, okays and fillers before the rest of the reply ("okay um yes but"). */
const LEAD = /^((yes|yeah|yep|yup|sure|of course(?! not\b)|ok|okay|alright|all right|please|um|uh|oh|ah|hmm|mm|well|so|hey|and|now|but)( |$))+/;
const SAID_YES = /\b(yes|yeah|yep|yup|sure|of course)\b/;
const SAID_OK = /\b(ok|okay|alright|all right|please)\b/;
const YES = /^(go ahead|do it|play it|read it|let'?s hear it|can do|will do)\b/;
/** A no keeps the "no" of "no need", "no point" and "no reason", so NO_FILLER sees "no need to read it". */
const NO = /^(?=no (need|point|reason)\b)|^(no( no(?! (need|point|reason)\b))*(?! (problem|worries|idea|clue|one|doubt|matter|wonder)\b)|nah|nope|not now|not right now|of course not|don'?t(?= (bother|worry|read|play|do|want|need)\b|$))( |$)/;
const WHOLE_NO = /^(not yet|not really|later|maybe later|maybe not|skip it|i'?m good)$/;
/** What a no can trail before a command: "no thanks, next step", "nah, no need, next step". */
const NO_TAIL = /^((no (need|point|reason)(?! (to|for)\b)|no(?! (need|point|reason)\b)|nah|nope|not now|not right now|thanks|thank you|but|just|um|uh|so|well|then|ok|okay)( |$))+/;
/** A command or a question (what cook.ts's FAST commands, timers and Claude are for). */
const COMMAND = /^(next|done|go on|go back|back|previous|last step|step back|repeat|again|say that|one more time|what|how|when|where|why|who|which|can|could|should|would|will|is|are|am i|do i|do you|do we|does|did|set|start|stop|pause|wait|hold on|hang on|help)\b|\btimer\b/;
/** More commands, only after a no (after an okay they'd be a yes: "Okay, read it."). */
const ACTION = /^(go to|skip|play|tell|show|read)\b/;
/** What a no can trail and still be only the no: "No, I'm good for now.", "Nah, no need for that.", "No, I got it." */
const NO_FILLER = new RegExp(
  "^(" +
    [
      "i'?m (all right|(all )?(good|fine|okay|ok|alright|set))( (on|with) (that|it|this))?",
      "(that'?s|it'?s) (fine|okay|ok|alright|all right)",
      "all good|never ?mind|i'?d rather not|skip( it| that)?",
      "(there'?s )?no (need|point|reason)( to( (read|play|do)( it| that| them)?( out loud)?)?| for (it|that))?",
      "i('?ve)? got (it|this)|i can do (it|this)|you don'?t (have|need) to",
      "(maybe )?(not|later|next time|another time)|not (yet|really|today|this time)",
      "don'?t( (bother|worry|read|play|do|want|need)( it| that| about it| to)?( out loud)?)?",
      "i don'?t (want|need) (it|that|this|one|any|to|to hear it)",
    ].join("|") +
    ")( (for now|right now|today|though|anyway|really|thanks( so much)?|thank you( so much)?))*$",
);

function parse(text: string) {
  const all = text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9' ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/( (please|thanks|thank you))+$/, "");
  const reply = all.replace(FILLERS, "");
  const lead = reply.match(LEAD)?.[0] ?? "";
  const rest = reply.slice(lead.length);
  const no = NO.exec(rest);
  const tail = no ? rest.slice(no[0].length) : "";
  // "Oh no" is a no only when a no follows it, or nothing does.
  const isNo = no ? !OH_NO.test(all) || !tail || NO.test(tail) || WHOLE_NO.test(tail) : WHOLE_NO.test(rest);
  return { lead, rest, isNo, tail: tail.replace(NO_TAIL, "") };
}

export function yesNo(text: string): "yes" | "no" | null {
  const { lead, rest, isNo } = parse(text);
  if (isNo) return "no";
  if (SAID_YES.test(lead) || YES.test(rest)) return "yes";
  if (!SAID_OK.test(lead)) return null;
  return rest && (COMMAND.test(rest) || /\?\s*$/.test(text)) ? null : "yes";
}

/** What a spoken no goes on to say ("No, next step." → "next step"), or "" when it's only the no. */
export function afterNo(text: string): string {
  const { isNo, tail } = parse(text);
  if (!isNo || !tail || NO_FILLER.test(tail)) return "";
  // A command, a question word, or a "?" after the no's own words ("No, too hot?", but not "No? Fine.").
  const asks = COMMAND.test(tail) || ACTION.test(tail) || /\w[^\w?]+\w[^?]*\?/.test(text);
  return asks || tail.split(" ").length >= 3 ? tail : "";
}
