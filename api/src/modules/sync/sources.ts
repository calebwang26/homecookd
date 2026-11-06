// How the sync reads the two old stores, behind an interface so tests use fakes. Reads only. Every call has a timeout and limited retries
// (SYSTEM-DESIGN.md), and its error holds a status and never a URL or a body.
export type ConvexFamily = {
  _id: string;
  _creationTime: number;
  name: string;
  supabaseFamilyId: string;
  publicName?: string;
  mossSync?: { startedAt: number; again: boolean };
};
export type ConvexPerson = {
  _id: string;
  _creationTime: number;
  familyId: string;
  supabaseProfileId: string;
  name: string;
  role: "cook" | "kid";
  voiceClone?: { consentedAt: number }; // her yes. The route leaves the Cartesia id in Convex
  language?: string;
  relation?: string;
  approx?: { lat: number; lng: number };
  campus?: string;
  deletedAt?: number;
};
export type ConvexRecipe = {
  _id: string;
  _creationTime: number;
  familyId: string;
  cookId: string;
  title: string;
  status: string;
  libraryId?: string;
  recipeJsonUrl?: string;
  coverUrl?: string;
  steps: unknown[];
  memories: unknown[];
  memoriesOptIn: boolean;
  mossIndexedAt?: number;
  language?: string;
  sharedAt?: number;
  storyCard?: { text: string; writtenAt: number; usedStories?: boolean; culture?: string; quote?: string };
  hiddenAt?: number;
  addedIngredients?: unknown[];
};
/** What the route gives from accountDeletions: ids and a time. Never its file URLs or voice clone id. */
export type ConvexDeletion = {
  id: string;
  creationTime: number;
  personId: string;
  familyId: string;
  supabaseProfileId: string;
  requestedAt: number;
  recipeIds: string[];
};
export type SupabaseFamily = { id: string; name: string };
export type SupabaseProfile = {
  id: string;
  family_id: string;
  name: string;
  role: string;
  relation: string | null;
  avatar_key: string | null;
  sort: number;
  email: string | null;
  tz: string | null;
  share_cooking: boolean | null;
  memorial: boolean;
  removed_at: string | null;
};

export type Rows = { families: ConvexFamily; people: ConvexPerson; recipes: ConvexRecipe };
export type Table = keyof Rows;
export type Page<T> = { rows: T[]; next: string | null };

export type ConvexSource = {
  /** One page of a whole table, oldest first. `next` is null at the end. */
  page<T extends Table>(table: T, cursor: string | null, limit: number): Promise<Page<Rows[T]>>;
  /** accountDeletions made after this time, oldest first. */
  deletions(afterMs: number, limit: number): Promise<ConvexDeletion[]>;
};
export type SupabaseSource = {
  families(ids: string[]): Promise<SupabaseFamily[]>;
  profiles(ids: string[]): Promise<SupabaseProfile[]>;
  /** Ids only, for the reconcile's count of what Convex has never seen. */
  familyIds(after: string | null, limit: number): Promise<string[]>;
  profileIds(after: string | null, limit: number): Promise<string[]>;
};

/** Convex no longer knows this cursor (an index change, say). The table starts again, which is safe. */
export class CursorExpired extends Error {
  override name = "CursorExpired";
}

type SourceName = "ConvexReadFailed" | "SupabaseReadFailed";

export class SourceFailed extends Error {
  override name: SourceName;
  readonly status: number | null;
  constructor(name: SourceName, status: number | null) {
    super(`read failed, status ${status ?? "none"}`);
    this.name = name;
    this.status = status;
  }
}

export type CallOptions = { timeoutMs?: number; tries?: number; backoffMs?: number };
const TIMEOUT_MS = 10_000;
const TRIES = 3;
const BACKOFF_MS = 500;

async function call(name: SourceName, url: string, init: RequestInit, options: CallOptions): Promise<unknown> {
  const tries = options.tries ?? TRIES;
  let failure = new SourceFailed(name, null);
  for (let attempt = 0; attempt < tries; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, (options.backoffMs ?? BACKOFF_MS) * 2 ** (attempt - 1)));
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS) });
      if (res.ok) return await res.json();
      if (res.status === 400 && name === "ConvexReadFailed") {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        if (body?.error === "bad_cursor") throw new CursorExpired("bad cursor");
      }
      failure = new SourceFailed(name, res.status);
      if (res.status !== 429 && res.status < 500) throw failure; // our mistake or a wrong secret: another try won't help
    } catch (error) {
      if (error instanceof CursorExpired || error === failure) throw error;
      failure = new SourceFailed(name, null); // a timeout, a dropped connection, a body that wasn't JSON
    }
  }
  throw failure;
}

const needed = (env: NodeJS.ProcessEnv, name: string): string => {
  const value = env[name]?.trim();
  if (!value) throw new Error(`The sync needs ${name}`);
  return value;
};

/** The read-only routes in convex/lib/syncRoutes.ts. CONVEX_SITE_URL is the deployment's .convex.site address. */
export function convexSource(env: NodeJS.ProcessEnv = process.env, options: CallOptions = {}): ConvexSource {
  const base = needed(env, "CONVEX_SITE_URL").replace(/\/+$/, "");
  const secret = needed(env, "SYNC_READ_SECRET");
  const post = (path: string, body: object) =>
    call(
      "ConvexReadFailed",
      `${base}${path}`,
      { method: "POST", headers: { "Content-Type": "application/json", "x-sync-secret": secret }, body: JSON.stringify(body) },
      options,
    );
  return {
    async page(table, cursor, limit) {
      const body = (await post("/sync/page", { table, cursor, limit })) as Page<never>;
      if (!Array.isArray(body?.rows) || !(body.next === null || typeof body.next === "string")) {
        throw new SourceFailed("ConvexReadFailed", 200);
      }
      return body;
    },
    async deletions(afterMs, limit) {
      const body = (await post("/sync/deletions", { after: afterMs, limit })) as { rows?: ConvexDeletion[] };
      if (!Array.isArray(body?.rows)) throw new SourceFailed("ConvexReadFailed", 200);
      return body.rows;
    },
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isSupabaseId = (id: string) => UUID.test(id);

// Family codes stay out of this list on purpose: moved areas don't sign anyone in, so codes wait for the accounts backfill.
const FAMILY_COLUMNS = "id,name";
const PROFILE_COLUMNS = "id,family_id,name,role,relation,avatar_key,sort,email,tz,share_cooking,memorial,removed_at";
const IN_ONE_CALL = 100;

/** PostgREST, with a key that can read these two tables. `ids` that aren't uuids (a seed's) have no Supabase row, so they aren't asked for. */
export function supabaseSource(env: NodeJS.ProcessEnv = process.env, options: CallOptions = {}): SupabaseSource {
  const base = needed(env, "SUPABASE_URL").replace(/\/+$/, "");
  const key = needed(env, "SUPABASE_SYNC_KEY");
  const get = async <T>(path: string): Promise<T[]> => {
    const body = await call("SupabaseReadFailed", `${base}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } }, options);
    if (!Array.isArray(body)) throw new SourceFailed("SupabaseReadFailed", 200);
    return body as T[];
  };
  const byIds = async <T>(table: string, columns: string, ids: string[]): Promise<T[]> => {
    const wanted = [...new Set(ids.filter(isSupabaseId))];
    const out: T[] = [];
    for (let i = 0; i < wanted.length; i += IN_ONE_CALL) {
      out.push(...(await get<T>(`${table}?select=${columns}&id=in.(${wanted.slice(i, i + IN_ONE_CALL).join(",")})`)));
    }
    return out;
  };
  const walk = async (table: string, after: string | null, limit: number): Promise<string[]> => {
    const from = after && isSupabaseId(after) ? `&id=gt.${after}` : "";
    return (await get<{ id: string }>(`${table}?select=id&order=id.asc&limit=${limit}${from}`)).map((row) => row.id);
  };
  return {
    families: (ids) => byIds<SupabaseFamily>("families", FAMILY_COLUMNS, ids),
    profiles: (ids) => byIds<SupabaseProfile>("profiles", PROFILE_COLUMNS, ids),
    familyIds: (after, limit) => walk("families", after, limit),
    profileIds: (after, limit) => walk("profiles", after, limit),
  };
}

export type Sources = { convex: ConvexSource; supabase: SupabaseSource };
let override: Sources | undefined;

export const syncSources = (): Sources => override ?? { convex: convexSource(), supabase: supabaseSource() };

/** For tests. */
export function useSyncSources(next: Sources | undefined): void {
  override = next;
}
