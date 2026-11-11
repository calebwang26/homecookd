// "Leo is cooking your chili" (RETENTION-HANDOFF 3.1): the calls to the api's live-cooking routes
// (supabase/functions/api/cooking.ts) and the two message calls the heart needs.
//
//   cookingApi.start({recipe_id, cook_id, step, total})  POST /cooking      (kid, in cook mode)
//   cookingApi.end(recipeId?)                            POST /cooking/end  ("I made it", leaving, idle)
//   cookingApi.live()                                    GET  /cooking      (cook Home: kids cooking my dishes)
//   cookingApi.share() / setShare(yes)                   GET/POST /profile/share-cooking (the consent answer)
//   cookingApi.sendHeart(kidId, recipeId)                the cook's heart: a 'reaction' in their 1:1 chat
//   heartFetcher(cookId)                                 the kid's 1:1 with the cook, messages after a time
//
// The calls go through their own small fetch so lib/api.ts stays as it is (the same pattern as
// lib/moveApi.ts); the headers are the ones the api client sends (getApiAuth), plus x-tz so the
// server knows the kid's local day for the one-push-a-day rule (getApiTimeZone: none while the web
// `?as=` dev aid borrows the build's code, exactly like the api client).
// TODO(wiring): once lib/api.ts has cooking calls & the 'reaction' kind, these can move there.
import { api, API_URL, getApiAuth, getApiTimeZone } from './api';
import { AWS_ON } from './aws/config';
import type { CookingStart, HeartLike, LiveCooking } from './cookingLogic';

export type { CookingStart, HeartLike, LiveCooking } from './cookingLogic';

export class CookingError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const TIMEOUT_MS = 10_000;

async function call<T>(path: string, opts: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<T> {
  // TODO(aws): who's cooking now (/cooking, /profile/share-cooking) isn't on the AWS api (JOBS.md open item 12).
  if (AWS_ON) throw new CookingError(501, 'Not ready yet.');
  const auth = getApiAuth();
  if (!auth.key && !auth.code) throw new CookingError(0, 'Not signed in.');
  if (!auth.profileId) throw new CookingError(0, 'No one picked on this phone.');
  const headers: Record<string, string> = { accept: 'application/json', 'x-profile-id': auth.profileId };
  const tz = getApiTimeZone();
  if (tz) headers['x-tz'] = tz;
  if (auth.key) headers['x-device-key'] = auth.key;
  else if (auth.code) headers['x-family-code'] = auth.code;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: abort.signal,
    });
  } catch {
    throw new CookingError(0, 'Can’t reach your family right now. Try again.');
  } finally {
    clearTimeout(timer);
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new CookingError(res.status, data?.error || 'Something went wrong. Try again.');
  return data as T;
}

const threadIds = new Map<string, Promise<string>>();

/** My 1:1 chat with someone (POST /threads makes it the first time), remembered per person. */
function threadWith(otherId: string): Promise<string> {
  const key = `${getApiAuth().profileId ?? ''}:${otherId}`;
  let p = threadIds.get(key);
  if (!p) {
    p = (AWS_ON ? api.openThread(otherId) : call<{ id: string }>('/threads', { method: 'POST', body: { other_id: otherId } })).then((t) => t.id);
    p.catch(() => threadIds.delete(key));
    threadIds.set(key, p);
  }
  return p;
}

export const cookingApi = {
  start: (input: { recipe_id: string; cook_id: string; step: number; total: number }) =>
    call<CookingStart>('/cooking', { method: 'POST', body: input }),
  end: (recipeId?: string | null) => call<{ ok: true }>('/cooking/end', { method: 'POST', body: recipeId ? { recipe_id: recipeId } : {} }),
  live: () => call<LiveCooking[]>('/cooking'),
  share: () => call<{ share_cooking: boolean | null }>('/profile/share-cooking'),
  setShare: (share: boolean) => call<{ ok: true; share_cooking: boolean }>('/profile/share-cooking', { method: 'POST', body: { share } }),
  /** The cook's heart for a kid mid-cook: a 'reaction' in their 1:1 chat (in-app only, never a push). */
  sendHeart: async (kidId: string, recipeId?: string | null) => {
    const threadId = await threadWith(kidId);
    if (AWS_ON) return (await api.sendMessage(threadId, { kind: 'reaction', body: 'heart', recipe_id: recipeId ?? null })) as unknown as HeartLike;
    return call<HeartLike>(`/threads/${encodeURIComponent(threadId)}/messages`, {
      method: 'POST',
      body: { kind: 'reaction', body: 'heart', ...(recipeId ? { recipe_id: recipeId } : {}) },
    });
  },
};

export type CookingClient = typeof cookingApi;

/**
 * The kid's heart watch fetcher (useCookingSession): messages in the 1:1 with the cook after a server
 * time (pass the server's own strings through: they keep microseconds).
 */
export function heartFetcher(cookId: string): (after: string) => Promise<HeartLike[]> {
  return async (after) => {
    const threadId = await threadWith(cookId);
    if (AWS_ON) return (await api.messages(threadId, after)) as unknown as HeartLike[];
    return call<HeartLike[]>(`/threads/${encodeURIComponent(threadId)}/messages?after=${encodeURIComponent(after)}`);
  };
}
