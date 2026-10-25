---
name: homie-counts-end-questions
description: "Oct 25: after \"I'm done\" homie first says how many questions it has (and the plate photo), asks them back to back, and the app keeps homie big in the middle until they're over ({type:\"hold\"})"
metadata:
  type: project
---

On 2026-10-25 Caleb asked for two things at the end of a recording: "after the dish finishes, homie should specify the
number of questions it has for the parent so that the parent can expect how long they need to stay for after the
dish", and "if homie is asking questions back to back … DONT transition out of the center expanded homie view into
the small homie in the corner view, then immediately snap back … homie should STAY in center expanded view until all
questions are finished, then snap back to small corner."

**Why:** the cook is done cooking and wants to eat or serve. Not knowing how many questions are coming makes the end
feel endless, and homie shrinking to the corner and jumping back between questions looks broken.

**How to apply:**
- The wrap-up order is fixed (`voice/src/record.ts` `wrapUp`): the count line, the end questions and the stories
  opt-in back to back, then (filmed in the app) the plate photo and its thanks, then the goodbye.
- The count line is its own short line, counting the real number: end questions left + the opt-in, and the plate
  photo if it will be asked ("Before we send it, two quick questions and a photo of your plate." / "Just two quick
  questions before we send it."). Numbers as words. Said once per recording; a reconnect doesn't repeat it, and asks
  the same questions it counted (`mem.endPlan`), never one more.
- Nothing homie says later contradicts the count: no "one more", "another", "last question" (Claude's end-question
  prompt says so too). The plate's "Last thing" is fine: it is the last thing.
- `{type:"hold", on:true}` goes out just before the count line (on a reconnect mid-run, right after `ready`/`phase`),
  `on:false` right before the plate ask or the goodbye, after the last question's wait (and a let-off, once played).
  The app keeps homie in the middle while it's on. Never on at `ended`.
- Any new run of spoken questions homie adds later gets counted and held the same way.
- Related: [[homie-waits-for-answers]], [[homie-size-and-centre]], [[in-app-recording]].
