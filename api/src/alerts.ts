// Tells the team something needs a look (convex/alerts.ts, the same three settings). REPORT_ALERT_URL is any webhook: ntfy (plain text
// with a Title header, also emailed with REPORT_ALERT_EMAIL and REPORT_ALERT_TOKEN), Slack or Discord. Unset means no alert (tests,
// dev). Never put family content in one. A failed alert is reported to the caller, so a queue can try it again.
const TIMEOUT_MS = 5_000;

function emailHeader(token: string | undefined): Record<string, string> {
  const email = process.env.REPORT_ALERT_EMAIL?.trim();
  if (!token || !email || !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(email)) return {};
  return { Email: email };
}

function ntfyToken(): string | undefined {
  const token = process.env.REPORT_ALERT_TOKEN?.trim();
  return token && /^tk_[A-Za-z0-9]{8,}$/.test(token) ? token : undefined;
}

async function post(url: string, init: RequestInit): Promise<number> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  return res.status;
}

/** Throws when the webhook can't be reached or refuses. */
export async function sendAlert(title: string, text: string): Promise<void> {
  const url = process.env.REPORT_ALERT_URL?.trim();
  if (!url) return;
  const slack = url.includes("hooks.slack.com");
  const discord = /discord(app)?\.com\/api\/webhooks/.test(url);
  let status: number;
  if (slack || discord) {
    const body = JSON.stringify(slack ? { text: `*${title}*\n${text}` } : { content: `**${title}**\n${text}` });
    status = await post(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
  } else {
    const push = { Title: title, Priority: "high", Tags: "rotating_light" };
    const token = ntfyToken();
    const extra = { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...emailHeader(token) };
    status = await post(url, { method: "POST", headers: { ...push, ...extra }, body: text });
    // ntfy refuses the whole message when it won't email, or the token is wrong: the push still goes.
    if (Object.keys(extra).length && status >= 400 && status < 500) {
      status = await post(url, { method: "POST", headers: push, body: text });
    }
  }
  if (status >= 400) throw new Error(`alert webhook answered ${status}`);
}
