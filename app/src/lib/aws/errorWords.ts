// The sentence a person sees for a failed AWS api call, in their language: the app's own words for its code
// (words/en/errors.ts), never the api's text for a code we know. A code we don't know yet shows the api's English
// sentence (ACCOUNTS.md: `message` is a fallback only). Pure TS (node scripts/test-aws.mjs).

import { english, type T, type WordKey } from '../words/words';
import { EN } from '../words/en/index';
import type { AwsError } from './errors';

// One word for each family of codes that means the same to a person.
const SAME: Record<string, string> = {
  no_route: 'unavailable',
  accounts_not_moved: 'not_moved',
};

function keyFor(code: string): WordKey | null {
  const k = `errors.${SAME[code] ?? code}`;
  return k in EN ? (k as WordKey) : null;
}

/** What to show for `e`: by its code, else by what kind of failure it is, else the api's own sentence. */
export function errorWords(e: AwsError, t: T = english): string {
  const own = e.code ? keyFor(e.code) : null;
  if (own) return t(own);
  if (e.kind === 'unavailable') return t('errors.unavailable');
  if (e.kind === 'network') return t(e.code === 'timeout' ? 'errors.timeout' : 'errors.network');
  // An unknown code, or a sentence from a route that doesn't send codes yet (the Accounts routes, until the
  // error-shape PR): the api's English.
  if (e.message && e.message !== e.code) return e.message;
  return e.kind === 'server' ? t('errors.server_error') : t('errors.invalid');
}
