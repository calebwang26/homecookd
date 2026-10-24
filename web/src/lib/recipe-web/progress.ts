// Cooking progress kept in this browser only, per recipe (the app keeps the same per profile):
//   checklist  which ingredients are set out, as row indexes
//   last step  the step the page was last on (1-based), so "Start cooking" can become "Back to step 4"
// Old "edible:" keys are read once and moved (lib/legacyKeys). Storage can throw
// (private mode, blocked site data); every read falls back to "nothing saved".
import { getItem, setItem } from '@/lib/legacyKeys';

const checklistKey = (id: string) => `homecookd:r:checked:${id}`;
const stepKey = (id: string) => `homecookd:r:step:${id}`;

function read<T>(key: string): T | null {
  try {
    const raw = getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    setItem(key, value == null ? null : JSON.stringify(value));
  } catch {
    /* storage unavailable: progress just isn't kept */
  }
}

export function readChecklist(recipeId: string): number[] {
  const v = read<unknown>(checklistKey(recipeId));
  return Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number') : [];
}

export function writeChecklist(recipeId: string, done: number[]): void {
  write(checklistKey(recipeId), done);
}

/** The last step (1-based) this browser was on for a recipe; 0 when none. */
export function readLastStep(recipeId: string): number {
  const v = read<unknown>(stepKey(recipeId));
  return typeof v === 'number' && v > 0 ? Math.floor(v) : 0;
}

export function writeLastStep(recipeId: string, step: number): void {
  write(stepKey(recipeId), step > 0 ? step : null);
}

/** "I made it": the app starts the next cook fresh (no resume, nothing ticked). */
export function clearProgress(recipeId: string): void {
  write(stepKey(recipeId), null);
  write(checklistKey(recipeId), null);
}
