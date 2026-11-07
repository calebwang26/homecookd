// Why a heart didn't save, in her words (components/recipes/HeartButton). Pure TS (node scripts/test-hearts.mjs).
import { errorWords } from './aws/errorWords';
import { isAwsError } from './aws/errors';
import { english, type T } from './words/words';

/**
 * The reason to show after "Couldn't save that heart.", or null for "Try again". A refusal the api explained (a 4xx:
 * the dish isn't there, a family it isn't in) is worth saying; an outage, a rate limit or a dropped connection is
 * worth another tap. On AWS (1.1) hearts fail with the api's AwsError (lib/aws/legacy.ts), read by its code in her
 * language (errorWords); before AWS, with api.ts's ApiError, whose message is the server's.
 */
export function heartFailureReason(err: unknown, t: T = english): string | null {
  if (isAwsError(err)) return err.kind === 'refused' && err.status !== 429 ? errorWords(err, t).trim() || null : null;
  const e = err as { name?: unknown; kind?: unknown; status?: unknown; message?: unknown } | null;
  if (!e || e.name !== 'ApiError' || e.kind !== 'http' || typeof e.status !== 'number') return null;
  if (e.status < 400 || e.status >= 500 || e.status === 429) return null;
  return typeof e.message === 'string' && e.message.trim() ? e.message.trim() : null;
}
