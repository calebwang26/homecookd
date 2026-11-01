// The daily model budget (DISH-ASK-SPEC.md §6): every paid call goes into today's `daily_spend` row and `model_calls`. The check runs before a call and
// the cost is added after it, as on Convex, so everything in flight when the cap is reached still lands: the overrun is what those calls cost. That's
// about $0.001 a card, but up to about $0.30 a page translation on Opus, so 100 first-time translations at once could pass the cap by tens of dollars
// (DISH-MIGRATION.md, known limits). The total can't be lost to a race (an atomic upsert), and only one caller can claim the day's alert.
import * as Sentry from "@sentry/node";
import { db, isPoolWait, tx } from "../../db.js";
import { enqueue } from "../../outbox.js";
import * as data from "./data.js";
import type { Log, Spend } from "./model.js";
import { DAILY_BUDGET_USD, dayOf, MOM_OVERAGE_USD } from "./values.js";

export type Trace = { requestId?: string; log: Log & { error: (o: object, m: string) => void } };

export const spentToday = () => data.spentOn(db(), dayOf(Date.now()));

const SPEND_TRIES = 3;

/**
 * Adds what a piece of work spent to today's total. Never throws: losing a cost record must not lose her answer. When every
 * connection is busy it tries again, because a lost record means the budget undercounts and stops too late. That can hold the caller
 * for about 15 s at worst, under overload only. If it's still lost, Sentry is told how much.
 */
export async function recordSpend(spend: Spend, askId: string | null, trace: Trace): Promise<void> {
  if (!(spend.usd > 0) && spend.calls.length === 0) return;
  const day = dayOf(Date.now());
  for (let attempt = 1; attempt <= SPEND_TRIES; attempt += 1) {
    try {
      await saveSpend(spend, askId, day, trace);
      return;
    } catch (error) {
      if (isPoolWait(error) && attempt < SPEND_TRIES) continue;
      trace.log.error(
        { usd: spend.usd, attempt, poolWait: isPoolWait(error), err: { type: (error as Error).name, code: (error as { code?: string }).code } },
        "dish spend wasn't recorded",
      );
      Sentry.captureException(Object.assign(new Error("DishSpendLost"), { name: "DishSpendLost" }), {
        tags: { usd: spend.usd.toFixed(4), pool_wait: String(isPoolWait(error)) },
      });
    }
  }
}

async function saveSpend(spend: Spend, askId: string | null, day: string, trace: Trace): Promise<void> {
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
}

export const budgetAlertText = (day: string, usd: number) =>
  `The dish ask spent $${usd.toFixed(2)} on ${day} (UTC), its $${DAILY_BUDGET_USD} daily budget. New cards are refused ` +
  `until tomorrow; Mom's answers still go through, up to $${DAILY_BUDGET_USD + MOM_OVERAGE_USD}.`;
