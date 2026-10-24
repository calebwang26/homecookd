// When homie may ask a question while a cook records (STACK.md, "homie while recording"). Plain code,
// so the model can't talk more than this: the first question no earlier than 4 minutes in, then 4.5
// minute gaps that double after each ignored question, at most 6 live questions plus 2 at the end.
// HOMIE_DEMO=1: the first at ~40 s, 90 s gaps, at most 2 live.

export type PaceRules = { firstS: number; gapS: number; maxLive: number; maxEnd: number };

export const NORMAL: PaceRules = { firstS: 240, gapS: 270, maxLive: 6, maxEnd: 2 };
export const DEMO: PaceRules = { firstS: 40, gapS: 90, maxLive: 2, maxEnd: 2 };

export class Pacer {
  private asked = 0;
  private lastAskS = -Infinity;
  private ignoredInARow = 0;

  constructor(readonly rules: PaceRules) {}

  /** True when the clock and the count allow a question now (`nowS` = seconds since filming started). */
  mayAsk(nowS: number): boolean {
    if (this.asked >= this.rules.maxLive || nowS < this.rules.firstS) return false;
    return nowS - this.lastAskS >= this.rules.gapS * 2 ** Math.min(this.ignoredInARow, 3);
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
