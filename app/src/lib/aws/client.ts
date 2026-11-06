// The one transport for the AWS api (1.1). Contract: docs/build/contracts/ACCOUNTS.md on aws-migration.
//
// Two credentials, both kept here (never logged or shown):
//   the device key   from sign-in; `x-device-key` on the family routes (/family, /profiles…, /join-links…, /devices/revoke)
//   a session token  from POST /v1/sessions/start; `Authorization: Bearer` on every other /v1 route. One per person:
//                    acting as someone with no phone (Grandma on Mom's phone) is a second session with her id.
// There's no refresh route: a /v1 401 starts the session again once and repeats the call once. A 401 to the
// device key itself (a family route, or sessions/start) means this phone was signed out: onDeadKey() hears it once.
//
// Retries inside one call are few and safe. A read, or a write with its Idempotency-Key, tries once more when
// the api is down, busy or broke. A write without a key tries again only on 429 or 503, when the api says
// nothing was written. Anything longer (polling, "trying again" on a screen) belongs to the caller: see
// errors.ts retryDelayMs. No stubs: a failed call throws an AwsError, and the screen keeps what it had.

import { AWS_URL } from './config';
import { AwsError, isAwsError, networkError, readError, retryDelayMs } from './errors';

const TIMEOUT_MS = 10_000;
/** Longest retry-after we wait for inside a call; longer, and the caller decides. */
const MAX_INLINE_WAIT_MS = 15_000;

export type Credential = 'none' | 'key' | 'session';

export type RequestOpts = {
  /** DELETE sends no body (COMMUNITY.md: unblock). */
  method?: 'GET' | 'POST' | 'DELETE';
  body?: Record<string, unknown>;
  /** Which credential the route takes. */
  auth: Credential;
  /** `key` routes: who is acting (x-profile-id). `session` routes: whose session (default: the current person). */
  as?: string | null;
  /** `key` routes: send this key instead of the phone's (an old key being revoked). */
  deviceKey?: string | null;
  /** For writes that create what someone wrote; the same key repeats safely. */
  idempotencyKey?: string;
  /** Extra headers a route reads (GET /v1/table's x-tz). */
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type Session = { sessionToken: string; familyId: string; personId: string; role: 'cook' | 'kid' };

type State = {
  deviceKey: string | null;
  /** Whose session a /v1 call uses when it doesn't say: the person using the app now. */
  personId: string | null;
  sessions: Map<string, Session>;
};

let state: State = { deviceKey: null, personId: null, sessions: new Map() };
let starting = new Map<string, Promise<Session>>();
const deadKeyListeners = new Set<() => void>();
let fetcher: typeof fetch = (input, init) => fetch(input, init);
let wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * After sign-in, when the app starts with a saved key, and whenever someone else picks up the phone.
 * A new key drops every session; a new person only changes whose session /v1 calls use.
 */
export function setAwsCredentials(next: { deviceKey?: string | null; personId?: string | null }) {
  const deviceKey = next.deviceKey !== undefined ? next.deviceKey : state.deviceKey;
  const personId = next.personId !== undefined ? next.personId : state.personId;
  if (deviceKey !== state.deviceKey) {
    state = { deviceKey, personId, sessions: new Map() };
    starting = new Map();
  } else {
    state = { ...state, personId };
  }
}

export function awsPersonId(): string | null {
  return state.personId;
}

/** The device key was refused, so this phone is signed out: heard once per key (api.ts tells the session). Returns the unsubscribe. */
export function onDeadKey(fn: () => void): () => void {
  deadKeyListeners.add(fn);
  return () => deadKeyListeners.delete(fn);
}

/** Tests only: a fake fetch and an instant clock. */
export function setAwsTransportForTests(f: typeof fetch, w?: (ms: number) => Promise<void>) {
  fetcher = f;
  if (w) wait = w;
}

const requestId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/**
 * Only the api's own word that the key is gone signs the phone out: a 401 `signed_out`, or (before the
 * error-shape PR) its sentence. A gateway's 401 or an outage never does (never-signed-out-by-a-crash.md).
 */
const saysKeyIsGone = (e: AwsError) => e.kind === 'signed_out' && (e.code === 'signed_out' || e.message === 'This phone was signed out.');

function keyDied(sentKey: string) {
  if (sentKey !== state.deviceKey) return; // an old key; this phone already moved on
  state = { deviceKey: null, personId: null, sessions: new Map() };
  starting = new Map();
  for (const fn of deadKeyListeners) {
    try {
      fn();
    } catch {
      // the session's trouble; this call still fails
    }
  }
}

async function once<T>(path: string, o: RequestOpts, rid: string, token: string | null): Promise<T> {
  if (!AWS_URL) throw new AwsError('homecookd isn’t set up in this build.', { status: 0, code: 'not_configured', kind: 'refused' });
  const method = o.method ?? (o.body ? 'POST' : 'GET');
  const headers: Record<string, string> = { accept: 'application/json', 'x-request-id': rid };
  if (method === 'POST') headers['content-type'] = 'application/json';
  let sentKey: string | null = null;
  if (o.auth === 'key') {
    const key = o.deviceKey ?? state.deviceKey;
    if (!key) throw new AwsError('Sign in first.', { status: 401, code: 'not_signed_in', kind: 'signed_out' });
    headers['x-device-key'] = sentKey = key;
    if (o.as) headers['x-profile-id'] = o.as;
  } else if (o.auth === 'session' && token) {
    headers.authorization = `Bearer ${token}`;
  }
  if (o.idempotencyKey) headers['idempotency-key'] = o.idempotencyKey;
  if (o.headers) Object.assign(headers, o.headers);

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  o.signal?.addEventListener?.('abort', onAbort);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, o.timeoutMs ?? TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetcher(`${AWS_URL}${path}`, {
      method,
      headers,
      body: method === 'POST' ? JSON.stringify(o.body ?? {}) : undefined,
      signal: controller.signal,
    });
  } catch {
    if (o.signal?.aborted) throw new AwsError('Cancelled', { status: 0, code: 'cancelled', kind: 'refused' });
    throw networkError(timedOut);
  } finally {
    clearTimeout(timer);
    o.signal?.removeEventListener?.('abort', onAbort);
  }
  const body = await res.text().catch(() => '');
  if (!res.ok) {
    const e = readError(res.status, body, res.headers.get('retry-after'));
    if (sentKey && saysKeyIsGone(e)) keyDied(sentKey);
    throw e;
  }
  if (!body) return undefined as T;
  try {
    return JSON.parse(body) as T;
  } catch {
    throw readError(502, body, null); // a 200 that isn't JSON: something in front of the api answered
  }
}

/** This person's session, started once and shared by concurrent calls. */
export function session(as?: string | null): Promise<Session> {
  const personId = as ?? state.personId;
  if (!state.deviceKey || !personId) return Promise.reject(new AwsError('Sign in first.', { status: 401, code: 'not_signed_in', kind: 'signed_out' }));
  const have = state.sessions.get(personId);
  if (have) return Promise.resolve(have);
  const inFlight = starting.get(personId);
  if (inFlight) return inFlight;
  const key = state.deviceKey;
  const p = request<Session>('/v1/sessions/start', { auth: 'none', body: { deviceKey: key, profileId: personId } })
    .then((s) => {
      if (state.deviceKey === key) state.sessions.set(personId, s);
      return s;
    })
    .catch((e: unknown) => {
      // sessions/start carries the key in its body: a 401 there is the key itself.
      if (isAwsError(e) && saysKeyIsGone(e)) keyDied(key);
      throw e;
    })
    .finally(() => {
      if (starting.get(personId) === p) starting.delete(personId);
    });
  starting.set(personId, p);
  return p;
}

/** Forget a person's session (it ended, or the person left). */
export function dropSession(as?: string | null) {
  const personId = as ?? state.personId;
  if (personId) state.sessions.delete(personId);
}

function mayRetry(e: AwsError, o: RequestOpts): boolean {
  const read = (o.method ?? (o.body ? 'POST' : 'GET')) === 'GET';
  if (read || o.idempotencyKey) return e.kind === 'unavailable' || e.kind === 'network' || e.kind === 'server';
  return e.status === 429 || e.status === 503; // the api wrote nothing
}

/** One call to the AWS api. Throws AwsError. */
export async function request<T>(path: string, o: RequestOpts): Promise<T> {
  const rid = requestId();
  const go = async (): Promise<T> => {
    if (o.auth !== 'session') return once<T>(path, o, rid, null);
    const s = await session(o.as);
    try {
      return await once<T>(path, o, rid, s.sessionToken);
    } catch (e) {
      if (!isAwsError(e) || e.status !== 401) throw e;
      // The session ended (30 days, or the server ended it): start it again once, then repeat once.
      if (state.sessions.get(s.personId)?.sessionToken === s.sessionToken) state.sessions.delete(s.personId);
      const fresh = await session(o.as);
      return once<T>(path, o, rid, fresh.sessionToken);
    }
  };
  try {
    return await go();
  } catch (e) {
    if (!isAwsError(e) || o.signal?.aborted || !mayRetry(e, o)) throw e;
    const ms = retryDelayMs(e, 0);
    if (ms > MAX_INLINE_WAIT_MS) throw e;
    await wait(ms);
    return go();
  }
}
