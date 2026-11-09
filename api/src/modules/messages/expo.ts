// The Expo push API, behind an interface so tests never call it. Convex's lib/push.ts and Supabase's sendExpoPush, which are the same code. Every call has a
// timeout. A response saying Expo didn't take the batch is tried once more; a timeout isn't, because Expo may have taken it. Nothing here throws, and nothing
// logs a token, a title or a body. A batch Expo surely didn't take (it said so, or the call never connected) comes back as UNAVAILABLE tickets, which the
// push machine tries again later (pushData.ts); a timeout comes back as a plain error, never tried again, so a push is never sent twice.

export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
export const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
export const EXPO_BATCH = 100;

export type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  sound: "default";
  priority: "high";
  channelId: "default";
  data: { url: string; kind: string; profile_id: string };
};
export type ExpoTicket = { status: "ok"; id: string } | { status: "error"; message: string; details?: { error?: string } };

export interface PushSender {
  /** One ticket per message, in order; `dead` are tokens Expo says are gone. */
  send(messages: ExpoMessage[]): Promise<{ tickets: ExpoTicket[]; dead: string[] }>;
  /** The ticket ids whose receipt says the device is gone. */
  deadReceipts(ids: string[]): Promise<string[]>;
}

type Options = { fetch?: typeof fetch; accessToken?: string | null; timeoutMs?: number; retryWaitMs?: number; log?: { error: (o: object, m: string) => void } };

const scrubToken = (s: string) => s.replace(/Expo(nent)?PushToken\[[^\]]*\]/g, "[token]").slice(0, 200);

const headers = (accessToken?: string | null) => ({
  accept: "application/json",
  "content-type": "application/json",
  ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
});

const NOT_TAKEN = new Set([429, 500, 502, 503, 504]);
/** A ticket's details.error when Expo didn't take the batch and may later. Expo's own MessageRateExceeded means the same. */
export const UNAVAILABLE = "Unavailable";
/** fetch failed before anything reached Expo. */
const NEVER_CONNECTED = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT"]);
const neverConnected = (error: unknown) => {
  const code = (error as { cause?: { code?: unknown } })?.cause?.code;
  return typeof code === "string" && NEVER_CONNECTED.has(code);
};

export async function sendExpoPush(messages: ExpoMessage[], o: Options = {}): Promise<{ tickets: ExpoTicket[]; dead: string[] }> {
  const doFetch = o.fetch ?? fetch;
  const tickets: ExpoTicket[] = [];
  const dead = new Set<string>();
  for (let i = 0; i < messages.length; i += EXPO_BATCH) {
    const batch = messages.slice(i, i + EXPO_BATCH);
    const failAll = (message: string, later: boolean) =>
      batch.forEach(() => tickets.push(later ? { status: "error", message, details: { error: UNAVAILABLE } } : { status: "error", message }));
    try {
      const post = () =>
        doFetch(EXPO_PUSH_URL, {
          method: "POST",
          headers: headers(o.accessToken),
          body: JSON.stringify(batch),
          signal: AbortSignal.timeout(o.timeoutMs ?? 5_000),
        });
      let res = await post();
      if (NOT_TAKEN.has(res.status)) {
        await res.body?.cancel();
        await new Promise((resolve) => setTimeout(resolve, o.retryWaitMs ?? 500));
        res = await post();
      }
      const out = (await res.json().catch(() => null)) as { data?: unknown } | null;
      if (!res.ok || !Array.isArray(out?.data)) {
        o.log?.error({ status: res.status }, "expo refused a batch");
        failAll(`HTTP ${res.status}`, NOT_TAKEN.has(res.status));
        continue;
      }
      const data = out.data as ExpoTicket[];
      batch.forEach((m, k) => {
        const t = data[k];
        if (!t || typeof t !== "object") {
          tickets.push({ status: "error", message: "No ticket" });
          return;
        }
        tickets.push(t.status === "error" ? { ...t, message: scrubToken(String(t.message)) } : t);
        if (t.status === "error" && t.details?.error === "DeviceNotRegistered") dead.add(m.to);
      });
    } catch (error) {
      o.log?.error({ err: { type: (error as Error).name } }, "expo call failed");
      failAll((error as Error).name, neverConnected(error));
    }
  }
  return { tickets, dead: [...dead] };
}

export async function deadReceipts(ids: string[], o: Options = {}): Promise<string[]> {
  if (ids.length === 0) return [];
  try {
    const res = await (o.fetch ?? fetch)(EXPO_RECEIPTS_URL, {
      method: "POST",
      headers: headers(o.accessToken),
      body: JSON.stringify({ ids }),
      signal: AbortSignal.timeout(o.timeoutMs ?? 5_000),
    });
    const out = (await res.json().catch(() => null)) as { data?: Record<string, ExpoTicket> } | null;
    if (!res.ok || !out?.data) {
      o.log?.error({ status: res.status }, "expo receipts failed");
      return [];
    }
    return Object.entries(out.data)
      .filter(([, r]) => r?.status === "error" && r.details?.error === "DeviceNotRegistered")
      .map(([id]) => id);
  } catch (error) {
    o.log?.error({ err: { type: (error as Error).name } }, "expo receipts failed");
    return [];
  }
}

const expo: PushSender = {
  send: (messages) => sendExpoPush(messages, { accessToken: process.env.EXPO_ACCESS_TOKEN?.trim() || null }),
  deadReceipts: (ids) => deadReceipts(ids, { accessToken: process.env.EXPO_ACCESS_TOKEN?.trim() || null }),
};

let current: PushSender = expo;

export const pushSender = () => current;

/** For tests. */
export function usePushSender(next: PushSender | undefined): void {
  current = next ?? expo;
}
