---
name: homie-no-guessed-roles
description: "Oct 24: homie never guesses a family role or gender ('your son', 'mom'); it uses names and the family's word for someone, else 'your family' / 'your loved one'"
metadata:
  type: feedback
---

On 2026-10-24 Caleb said: "regardless of who I am, as a cook, the AI homie will always refer to me as like a mom
… 'your son really wants to see you cook' … what if I'm a grandparent? … make it contextual to the profile …
Or … use more general terms like 'cooked for your loved one'."

**The rule:**
- homie uses what it really knows: names, and the family's own word for someone (`people.relation`, like "Aaji").
- Otherwise it says "your family" / "your loved one".
- It never says son, daughter, grandchild, mom, dad or grandma unless that's literally the given name or word.
- It never assumes the cook's gender. In Marathi, it keeps the respectful तुम्ही forms.
- homie's own voice stays as Caleb chose it.

**Why:** a cook can be a grandparent, an aunt or a dad. A wrong guess feels like homie doesn't know the family.

**How to apply:**
- Every Claude prompt that writes homie's words includes the never-guess rule (`voice/src/homie.ts`
  `neverGuess`, plus `tapLine.ts`, `agent.ts` and `translate.ts`).
- The guard `guessesFamily` falls back to a written line when Claude slips anyway.
- Written lines say "for your family" when there's no kid name. A native Marathi check of "घरच्यांसाठी" is
  still a TODO(caleb).
- Open: `record.ts` builds `call` as name + relation, so a "Vijay" whose relation is "Dad" becomes "Vijay Dad".
