// Tiny fetch helpers shared by the bucket loaders (recipes.ts) and the upload client (uploads.ts).

/** A query param that changes once a minute, so CDN/browser caches never hide new recipes for long. */
export function cacheBuster(url: string): string {
  const t = Math.floor(Date.now() / 60000);
  return `${url}${url.includes('?') ? '&' : '?'}t=${t}`;
}

/** GET a JSON document with a timeout. Non-2xx answers resolve with `data: null`. */
export async function fetchJson(url: string, timeoutMs = 8000): Promise<{ status: number; data: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return { status: res.status, data: null };
    return { status: res.status, data: await res.json() };
  } finally {
    clearTimeout(timer);
  }
}
