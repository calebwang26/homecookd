// The cooking time shown on a dish row.
import { totalMinutes } from '@/lib/recipes';

/** "~1 hr 20 min", "10 min", "~2 hrs + overnight" from a recipe's free-text total_time. */
export function rowTime(total: string | null | undefined): string | null {
  const t = (total ?? '').trim();
  if (!t) return null;
  const mins = totalMinutes({ total_time: t });
  if (mins == null || mins <= 0) return null;
  let s: string;
  if (mins < 60) s = `${mins} min`;
  else {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    s = m ? `${h} hr ${m} min` : `${h} ${h === 1 ? 'hr' : 'hrs'}`;
  }
  if (/overnight/i.test(t)) s += ' + overnight';
  return t.startsWith('~') ? `~${s}` : s;
}
