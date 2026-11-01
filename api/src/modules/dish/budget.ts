// The daily model budget (DISH-ASK-SPEC.md §6): every paid call goes into today's `daily_spend` row and `model_calls`. The check runs
// before each paid call, so a few calls at the same moment can pass the cap by cents, as today. The total can't be lost to a race (an
// atomic upsert), and only one caller can claim the day's alert.
import { db, tx } from "../../db.js";
import { enqueue } from "../../outbox.js";
import * as data from "./data.js";
import type { Log, Spend } from "./model.js";
import { DAILY_BUDGET_USD, dayOf, MOM_OVERAGE_USD } from "./values.js";

export type Trace = { requestId?: string; log: Log & { error: (o: object, m: string) => void } };

export const spentToday = () => data.spentOn(db(), dayOf(Date.now()));

/** Adds what a piece of work spent to today's total. Never throws: losing a cost record must not lose her answer. */
export async function recordSpend(spend: Spend, askId: string | null, trace: Trace): Promise<void> {
  if (!(spend.usd > 0) && spend.calls.length === 0) return;
  const day = dayOf(Date.now());
  try {
    await tx(async (c) => {
      if (spend.usd > 0) await data.addSpend(c, day, spend.usd);
      await data.insertModelCalls(c, askId, spend.calls);
      const total = await data.claimBudgetAlert(c, day, DAILY_BUDGET_USD);
      if (total !== null) {
        trace.log.error({ day, usd: total, budget: DAILY_BUDGET_USD }, "ALERT dish budget reached");
        await enqueue(c, { queue: "scheduled", payload: { task: "dish.budget_alert", day, usd: total }, requestId: trace.requestId });
      }
    });
    spend.usd = 0;
    spend.calls = [];
  } catch (error) {
    trace.log.error({ usd: spend.usd, err: { type: (error as Error).name } }, "dish spend wasn't recorded");
  }
}

export const budgetAlertText = (day: string, usd: number) =>
  `The dish ask spent $${usd.toFixed(2)} on ${day} (UTC), its $${DAILY_BUDGET_USD} daily budget. New cards are refused ` +
  `until tomorrow; Mom's answers still go through, up to $${DAILY_BUDGET_USD + MOM_OVERAGE_USD}.`;
