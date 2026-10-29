// The Expo push API and the clock rules behind convex/push.ts, ported from Supabase's plumbing.ts and time.ts
// (sendExpoPush, validPushToken, quiet hours) so both systems send the same way (docs/build/V2-LINKING.md §1.3).
// Plain functions with fetch passed in, so the tests run without the network.

export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
export const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
export const EXPO_BATCH = 100;
export const DEFAULT_TZ = "America/Los_Angeles";
export const QUIET_FROM_HOUR = 21;
export const QUIET_TO_HOUR = 8;

const EXPO_TOKEN = /^Expo(nent)?PushToken\[[^\]\s]{1,200}\]$/;

/** ExponentPushToken[...] or ExpoPushToken[...], as getExpoPushTokenAsync returns it. */
export function validPushToken(v: unknown): v is string {
  return typeof v === "string" && EXPO_TOKEN.test(v);
}

/** An IANA zone the runtime knows, else null. */
export function validTz(name: unknown): string | null {
  if (typeof name !== "string" || !name || name.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return name;
  } catch {
    return null;
  }
}

/** Minutes past midnight on the wall clock in `tz`. */
function localMinutes(now: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: validTz(tz) ?? DEFAULT_TZ,
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(now));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

/** How long until quiet hours (21:00–08:00 in `tz`) end; 0 outside them. A DST night can be an hour off. */
export function quietDelayMs(now: number, tz: string): number {
  const m = localMinutes(now, tz);
  const from = QUIET_FROM_HOUR * 60;
  const to = QUIET_TO_HOUR * 60;
  if (m < from && m >= to) return 0;
  return (((to - m) % 1440) + 1440) % 1440 * 60_000;
}

export type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  sound: "default";
  priority: "high";
  channelId: "default";
  data: { url: string; kind: string; profile_id: string };
};
export type ExpoTicket =
  | { status: "ok"; id: string }
  | { status: "error"; message: string; details?: { error?: string } };

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

function headers(accessToken?: string): Record<string, string> {
  const h: Record<string, string> = { accept: "application/json", "content-type": "application/json" };
  if (accessToken) h.authorization = `Bearer ${accessToken}`;
  return h;
}

/** Sends in batches of 100. One ticket per message, in order; `dead` are tokens Expo says are gone. Never throws. */
export async function sendExpoPush(
  messages: ExpoMessage[],
  opts: { fetch?: Fetch; accessToken?: string; timeoutMs?: number } = {},
): Promise<{ tickets: ExpoTicket[]; dead: string[] }> {
  const doFetch = opts.fetch ?? fetch;
  const tickets: ExpoTicket[] = [];
  const dead = new Set<string>();
  for (let i = 0; i < messages.length; i += EXPO_BATCH) {
    const batch = messages.slice(i, i + EXPO_BATCH);
    const failAll = (message: string) => batch.forEach(() => tickets.push({ status: "error", message }));
    try {
      const timeout = opts.timeoutMs ?? 5000;
      const res = await doFetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: headers(opts.accessToken),
        body: JSON.stringify(batch),
        signal: timeout > 0 ? AbortSignal.timeout(timeout) : undefined,
      });
      const out = (await res.json().catch(() => null)) as { data?: unknown; errors?: { code?: string }[] } | null;
      if (!res.ok || !Array.isArray(out?.data)) {
        console.error("push send failed:", res.status, (out?.errors ?? []).map((e) => e.code).join(","));
        failAll(`HTTP ${res.status}`);
        continue;
      }
      const data = out.data as ExpoTicket[];
      batch.forEach((m, k) => {
        const t = data[k];
        if (!t || typeof t !== "object") {
          tickets.push({ status: "error", message: "No ticket" });
          return;
        }
        tickets.push(t);
        if (t.status === "error" && t.details?.error === "DeviceNotRegistered") dead.add(m.to);
      });
    } catch (e) {
      console.error("push send error:", String(e));
      failAll(String(e));
    }
  }
  return { tickets, dead: [...dead] };
}

/** The ticket ids whose receipt says the device is gone (Expo reports most dead tokens here, not in tickets). */
export async function deadReceipts(
  ids: string[],
  opts: { fetch?: Fetch; accessToken?: string } = {},
): Promise<string[]> {
  if (!ids.length) return [];
  try {
    const res = await (opts.fetch ?? fetch)(EXPO_RECEIPTS_URL, {
      method: "POST",
      headers: headers(opts.accessToken),
      body: JSON.stringify({ ids }),
      signal: AbortSignal.timeout(5000),
    });
    const out = (await res.json().catch(() => null)) as { data?: Record<string, ExpoTicket> } | null;
    if (!res.ok || !out?.data) {
      console.error("push receipts failed:", res.status);
      return [];
    }
    return Object.entries(out.data)
      .filter(([, r]) => r?.status === "error" && r.details?.error === "DeviceNotRegistered")
      .map(([id]) => id);
  } catch (e) {
    console.error("push receipts error:", String(e));
    return [];
  }
}
