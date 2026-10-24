// The phone's IANA time zone ("America/New_York"), for the x-tz header the api stores on the acting
// profile (RETENTION-HANDOFF 2.3): Sunday-table weeks, quiet hours & the 1st-of-month recap all run
// on the recipient's local clock. Pure: no network, no React Native imports.
//
//   deviceTimeZone() // 'America/Los_Angeles' when the runtime can't say
//
// Read fresh each call (cheap): session.tsx calls it again whenever the app comes back to the
// front, so someone who flew home with the app still running sends their new zone from then on.

/** The default the server also uses when a profile has no zone yet. */
export const DEFAULT_TZ = 'America/Los_Angeles';

/** The device's IANA time zone, or DEFAULT_TZ when Intl is missing or answers nothing usable. */
export function deviceTimeZone(): string {
  let tz = '';
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    tz = '';
  }
  // The server accepts at most 64 characters; anything odd falls back rather than being refused.
  return typeof tz === 'string' && tz.length > 0 && tz.length <= 64 ? tz : DEFAULT_TZ;
}
