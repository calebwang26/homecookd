/**
 * Cartesia (Sonic TTS, Ink STT). The API key stays here on the server, in the CARTESIA_API_KEY secret;
 * the app and web only ever get a short-lived access token from POST /voice/token and call
 * https://api.cartesia.ai themselves with it. Docs: https://docs.cartesia.ai/get-started/authenticate-your-client-applications
 */

export const CARTESIA_URL = "https://api.cartesia.ai";
/** The date we tested against; sent on every request (https://docs.cartesia.ai/use-the-api/api-conventions). */
export const CARTESIA_VERSION = "2026-08-14";
/** Token lifetime. Cartesia's max is 3600; a few minutes covers one cook-mode screen. */
export const CARTESIA_TOKEN_TTL_S = 300;

export type CartesiaGrants = { tts: boolean; stt: boolean };

/** POST /access-token. Throws with Cartesia's own error message (structured JSON since 2026-03-01). */
export async function mintCartesiaToken(apiKey: string, grants: CartesiaGrants): Promise<string> {
  const res = await fetch(`${CARTESIA_URL}/access-token`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Cartesia-Version": CARTESIA_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ grants, expires_in: CARTESIA_TOKEN_TTL_S }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || typeof out.token !== "string") {
    throw new Error(`cartesia access-token ${res.status}: ${out.error_code ?? ""} ${out.message ?? ""}`.trim());
  }
  return out.token;
}
