// When homie may ask a question while a cook records (STACK.md, "homie while recording"). Plain code,
// so the model can't talk more than this: the first question no earlier than 2 minutes in, then 3.5
// minute gaps that double after each ignored question, at most 8 live questions plus 2 at the end.
// Oct 24 (guidance only, filming in the app): homie's questions are now small capture asks ("How much
// salt was that?", "Can you tilt the pan toward me?") that matter while the moment is on camera, so
// they start sooner and come a little more often than the old 4 min / 4.5 min / 6. An ignored one still
// backs homie off, and she can always say "not now".
// HOMIE_DEMO=1: the first at ~40 s, 90 s gaps, at most 2 live.
// HOMIE_SCRIPTED=1 (the filmed demo): a fixed question every 5 minutes, no backing off after an ignored one.

export type PaceRules = { firstS: number; gapS: number; maxLive: number; maxEnd: number; backoff?: boolean };

export const NORMAL: PaceRules = { firstS: 120, gapS: 210, maxLive: 8, maxEnd: 2 };
export const DEMO: PaceRules = { firstS: 40, gapS: 90, maxLive: 2, maxEnd: 2 };
export const SCRIPTED: PaceRules = { firstS: 300, gapS: 300, maxLive: 12, maxEnd: 2, backoff: false };

export class Pacer {
  private asked = 0;
  private lastAskS = -Infinity;
  private ignoredInARow = 0;

  constructor(readonly rules: PaceRules) {}

  /** True when the clock and the count allow a question now (`nowS` = seconds since filming started). */
  mayAsk(nowS: number): boolean {
    if (this.asked >= this.rules.maxLive || nowS < this.rules.firstS) return false;
    const backoff = this.rules.backoff === false ? 0 : Math.min(this.ignoredInARow, 3);
    return nowS - this.lastAskS >= this.rules.gapS * 2 ** backoff;
  }

  onAsk(nowS: number) {
    this.asked++;
    this.lastAskS = nowS;
  }

  answered() {
    this.ignoredInARow = 0;
  }

  /** No answer, or "not now": wait twice as long before the next one. */
  ignored() {
    this.ignoredInARow++;
  }
}
