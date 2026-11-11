// The five move-request calls (the story, and the store the Home pop-up shares, are in lib/moveRequests.ts):
//
//   moveApi.ask(profileId)   POST /move-requests             (the new phone; no person yet)
//   moveApi.mine()           GET  /move-requests/mine        (the new phone, while it waits)
//   moveApi.list()           GET  /move-requests             (as the person: the asks they may answer)
//   moveApi.approve(id)      POST /move-requests/:id/approve (someone on their own phone)
//   moveApi.decline(id)      POST /move-requests/:id/decline
//
// Off the switch (1.0) they go to the Supabase api through their own small fetch, with the headers the api client
// sends (getApiAuth), as before. Under AWS_ON (1.1) they go to the AWS api, which has the same routes, headers and
// shapes (api/src/modules/accounts/routes.ts, moves.ts), through lib/aws/client.ts: its retries, and the api's own
// "this phone was signed out" heard once. A refusal there reads in the person's own words (aws/errorWords), as the
// api client's do. Plain TS with no React Native imports: scripts/test-move-requests.mjs runs it under Node.
import { API_URL, getApiAuth, getApiLanguage, type Profile } from './api';
import { request as awsRequest } from './aws/client';
import { AWS_ON } from './aws/config';
import { errorWords } from './aws/errorWords';
import { isAwsError } from './aws/errors';
import { wordsFor } from './words/words';

export type MoveStatus = 'pending' | 'approved' | 'declined' | 'expired';
/**
 * `asked`: while pending, up to 3 names who can let this phone in ("Waiting for Mom or Dad");
 * `let_in_by`: who did, once approved. Both missing on older servers.
 */
export type MyMoveRequest = { id: string; profile_id: string; status: MoveStatus; asked?: string[]; let_in_by?: string | null };
export type MoveRequest = { id: string; profile: Profile; created_at: string };

// No parameter properties: Node's type stripping (scripts/test-move-requests.mjs) can't run them.
export class MoveError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Opts = { method?: 'GET' | 'POST'; body?: unknown; asPerson?: boolean };

/** 1.1: the AWS api, with this phone's device key and, as the person, x-profile-id. */
async function awsCall<T>(path: string, opts: Opts): Promise<T> {
  try {
    return await awsRequest<T>(path, {
      method: opts.method ?? 'GET',
      body: opts.body as Record<string, unknown> | undefined,
      auth: 'key',
      as: opts.asPerson ? getApiAuth().profileId : null,
    });
  } catch (e) {
    if (!isAwsError(e)) throw new MoveError(0, wordsFor(getApiLanguage())('errors.network'));
    throw new MoveError(e.status, errorWords(e, wordsFor(getApiLanguage())));
  }
}

async function call<T>(path: string, opts: Opts = {}): Promise<T> {
  if (AWS_ON) return awsCall<T>(path, opts);
  const auth = getApiAuth();
  const headers: Record<string, string> = { accept: 'application/json' };
  if (auth.key) headers['x-device-key'] = auth.key;
  else if (auth.code) headers['x-family-code'] = auth.code;
  if (opts.asPerson && auth.profileId) headers['x-profile-id'] = auth.profileId;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new MoveError(0, 'Can’t reach your family right now. Try again.');
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new MoveError(res.status, data?.error || 'Something went wrong. Try again.');
  return data as T;
}

export const moveApi = {
  ask: (profileId: string) => call<MyMoveRequest>('/move-requests', { method: 'POST', body: { profile_id: profileId } }),
  mine: () => call<MyMoveRequest | null>('/move-requests/mine'),
  list: () => call<MoveRequest[]>('/move-requests', { asPerson: true }),
  approve: (id: string) => call<{ ok: true }>(`/move-requests/${encodeURIComponent(id)}/approve`, { method: 'POST', body: {}, asPerson: true }),
  decline: (id: string) => call<{ ok: true }>(`/move-requests/${encodeURIComponent(id)}/decline`, { method: 'POST', body: {}, asPerson: true }),
};
