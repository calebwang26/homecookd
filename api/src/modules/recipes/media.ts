// A row holds a key, and a link is built when it's read, so hosts can change (SYSTEM-DESIGN.md). The worker's recipe.json keeps full CDN links, because the app reads them.
export const encodeKey = (key: string) => key.split("/").map(encodeURIComponent).join("/");

/** A public file in the media bucket, on the CDN. Fails loudly without its setting, as `objectStore()` does: a recipe with no picture would hide the mistake. */
export function mediaUrl(key: string, version?: string | null): string {
  const base = process.env.MEDIA_BASE_URL?.trim().replace(/\/+$/, "");
  if (!base) throw new Error("MEDIA_BASE_URL isn't set");
  return `${base}/${encodeKey(key)}${version ? `?v=${encodeURIComponent(version)}` : ""}`;
}

/** One of our own stock photos, on the website. */
export const stockUrl = (path: string) => `https://homecookd.app/media/${path}`;
