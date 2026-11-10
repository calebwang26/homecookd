---
name: send-again-failed-upload
description: "Nov 10: a recording whose upload gave up gets a real Send again button on Home that re-sends its kept videos"
metadata:
  type: project
---

On 2026-11-10 Caleb decided that a recording whose upload from the phone gave up gets a real **Send again** button on
its Home row, not only the x that clears it. His words, typed in the General Questions chat at about 9:55 AM PT and relayed
by the Master Agent: "Yes, if he'll upload, should say send again." It answered the question about #474's row, which said
"send them again" but had only an x (that discards the kept videos at once, with no Undo).

**Why:** a cook whose upload failed (bad kitchen Wi-Fi) must be able to send it again from where she sees it failed,
without waiting for the next launch's automatic resend or filming again.

**How to apply:**
- The row says "Your videos didn't send" with Send again while its kept videos are on the phone. Send again sends that
  recording's note through the same path a launch's resend uses (`useResendUnsent` `sendNoteAgain`: its stuck job
  stopped, then `sendDraft`), by hand: no give-up for its tries or age.
- It runs on Send's own machine, one per recording (`components/parent/sendAgain`): one tap, one send. The button is
  disabled while it sends, and a failure says so and brings the button back.
- If the videos aren't on the phone any more, the row says so plainly and offers no button; the x still clears it.
- Changing the wording or the button needs Caleb's word.
