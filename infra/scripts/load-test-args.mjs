// load-test.mjs's arguments and guards, on their own so load-test.test.mjs can check them without a network.
// Staging is any http(s) address that doesn't look like production. Production is https://api.homecookd.app only, with both
// --production and LOAD_TEST_PRODUCTION=yes, and the number of cards said out loud: each card is one real Claude call there.

export const USAGE = 'usage: load-test.mjs <staging api url> [--rps 50] [--ramp 2] [--minutes 15] [--burst 300] [--cards 4]   (never production)';
export const PRODUCTION_USAGE =
  'usage: LOAD_TEST_PRODUCTION=yes load-test.mjs https://api.homecookd.app --production --cards <1 to 6> [--rps 50] [--ramp 2] [--minutes 15] [--burst 300]';
export const PRODUCTION_HOST = 'api.homecookd.app';
const LOOKS_LIKE_PRODUCTION = /homecookd\.app|production/;

/** { base, rps, minutes, burst, cards, production } to run, or { error } to print before exiting 2. */
export function settings(args, env) {
  const base = (args[0] ?? '').replace(/\/+$/, '');
  const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i > 0 ? Number(args[i + 1]) : fallback;
  };
  const production = args.includes('--production');
  // At most 6 cards: the per-address limit is 6 in 10 minutes. --ramp: minutes climbing to --rps before the scored window (0 = none).
  const s = { base, rps: flag('rps', 50), ramp: flag('ramp', 2), minutes: flag('minutes', 15), burst: flag('burst', 300), cards: Math.min(flag('cards', 4), 6), production };
  const numbers = [s.rps, s.ramp, s.minutes, s.burst, s.cards].every((n) => Number.isFinite(n) && n >= 0);

  if (!production) {
    if (!/^https?:\/\//.test(base) || LOOKS_LIKE_PRODUCTION.test(base) || !numbers) return { error: USAGE };
    return s;
  }
  if (env.LOAD_TEST_PRODUCTION !== 'yes') return { error: `--production also needs LOAD_TEST_PRODUCTION=yes in the environment.\n${PRODUCTION_USAGE}` };
  let url = null;
  try {
    url = new URL(base);
  } catch {}
  if (url?.protocol !== 'https:') return { error: `Production is over HTTPS only.\n${PRODUCTION_USAGE}` };
  if (url.hostname !== PRODUCTION_HOST || url.pathname !== '/' || url.search) return { error: `--production is only for https://${PRODUCTION_HOST}.\n${PRODUCTION_USAGE}` };
  if (!numbers) return { error: PRODUCTION_USAGE };
  if (args.indexOf('--cards') <= 0 || s.cards < 1) {
    return { error: `Say how many cards, 1 to 6: on production each is one real Claude guess (Haiku, about $0.001), and the cards stay until they're deleted.\n${PRODUCTION_USAGE}` };
  }
  return s;
}
