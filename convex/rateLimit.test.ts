// Which IP the per-IP limits count (lib/rateLimit.ts clientIp), as Convex's Cloudflare edge sends it.
import { expect, test } from "vitest";
import { clientIp } from "./lib/rateLimit";

const req = (headers: Record<string, string>) => new Request("https://x.convex.site/dish/cards", { method: "POST", headers });

test("clientIp: Cloudflare's CF-Connecting-IP first, then the last X-Forwarded-For hop; never True-Client-IP", () => {
  expect(clientIp(req({ "CF-Connecting-IP": "203.0.113.7", "X-Forwarded-For": "6.6.6.6" }))).toBe("203.0.113.7");
  expect(clientIp(req({ "X-Forwarded-For": "6.6.6.6, 203.0.113.7" })), "a caller's own first hop is ignored").toBe("203.0.113.7");
  expect(clientIp(req({ "X-Forwarded-For": "203.0.113.7" }))).toBe("203.0.113.7");
  expect(clientIp(req({ "True-Client-IP": "5.5.5.5" }))).toBe("unknown");
  expect(clientIp(req({}))).toBe("unknown");
});
