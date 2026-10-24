// Public endpoints for the web pages (/r recipe, /i invite, /d dinner invite). All are public values
// (no secrets): the API's share and invite-preview routes are unauthenticated by design, the bucket is
// a public read-only bucket, and Convex's POST /invite/open is public too (it answers only a dinner's
// dish, its host's first name and when). Override at build time with NEXT_PUBLIC_API_URL /
// NEXT_PUBLIC_BUCKET_URL / NEXT_PUBLIC_CONVEX_SITE_URL.
const trim = (s: string) => s.trim().replace(/\/+$/, '');

export const API_URL = trim(
  process.env.NEXT_PUBLIC_API_URL || 'https://bsudybxsqvtwftsdmwmz.supabase.co/functions/v1/api',
);

export const BUCKET_URL = trim(
  process.env.NEXT_PUBLIC_BUCKET_URL || 'https://storage.googleapis.com/edible-media-379797517579',
);

/** The Convex deployment's HTTP host (`.convex.site`, not the client's `.convex.cloud`). */
export const CONVEX_SITE_URL = trim(process.env.NEXT_PUBLIC_CONVEX_SITE_URL || 'https://grand-dragon-649.convex.site');

/** ?fixture= (/r recipe ids, /i invite states) only works on a local host (next dev, or `serve out`). */
export function fixtureAllowed(): boolean {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.localhost');
}
