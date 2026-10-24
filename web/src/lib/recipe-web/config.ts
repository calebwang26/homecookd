// Public endpoints for the web pages (/r recipe, /i invite). Both are public values (no secrets): the
// API's share and invite-preview routes are unauthenticated by design, and the bucket is a public
// read-only bucket. Override at build time with NEXT_PUBLIC_API_URL / NEXT_PUBLIC_BUCKET_URL.
const trim = (s: string) => s.trim().replace(/\/+$/, '');

export const API_URL = trim(
  process.env.NEXT_PUBLIC_API_URL || 'https://bsudybxsqvtwftsdmwmz.supabase.co/functions/v1/api',
);

export const BUCKET_URL = trim(
  process.env.NEXT_PUBLIC_BUCKET_URL || 'https://storage.googleapis.com/edible-media-379797517579',
);

/** ?fixture= (/r recipe ids, /i invite states) only works on a local host (next dev, or `serve out`). */
export function fixtureAllowed(): boolean {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.localhost');
}
