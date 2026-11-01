// Sign in with Apple and Google: checking the id token a phone sends. Real signature, issuer, audience and expiry checks, against the provider's published keys,
// behind one interface, so tests use fake keys and never call Apple or Google. Which answer for which failure is Supabase's, because a store build's life
// depends on it: a bad token is 401; keys that can't be fetched are 503 (try again); a real token for an app id we don't list is 503 "not set up".
import * as Sentry from "@sentry/node";
import { createRemoteJWKSet, errors as joseErrors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { MAX_NAME, refuse } from "./values.js";

export type Provider = "apple" | "google";
export type Who = { provider: Provider; sub: string; email: string | null; givenName: string | null };

const APP_BUNDLE_ID = "com.salik.homecookd";
// TODO(caleb): drop this once no Expo Go testing remains. Any Expo Go project can get Apple tokens for this audience, so a hostile one could replay its users'
// tokens here (Supabase's TODO(security), kept so behavior doesn't change at the switch).
const EXPO_GO_BUNDLE_ID = "host.exp.Exponent";

const KEYS_TIMEOUT_MS = 5_000;

const envList = (name: string, fallback: string[]) => {
  const list = (process.env[name] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.length ? list : fallback;
};

const LABEL: Record<Provider, string> = { apple: "Apple", google: "Google" };
const ISSUERS: Record<Provider, string[]> = {
  apple: ["https://appleid.apple.com"],
  google: ["accounts.google.com", "https://accounts.google.com"],
};
const KEY_URLS: Record<Provider, string> = {
  apple: "https://appleid.apple.com/auth/keys",
  google: "https://www.googleapis.com/oauth2/v3/certs",
};

export const audiencesOf = (provider: Provider) =>
  provider === "apple" ? envList("APPLE_AUDIENCES", [EXPO_GO_BUNDLE_ID, APP_BUNDLE_ID]) : envList("GOOGLE_CLIENT_IDS", []);

export interface IdTokens {
  /** Who the token proves, or the refusal to send. */
  verify(provider: Provider, idToken: string): Promise<Who>;
}

/** The real checks, with whatever key sets it's given. Only RS256 is taken, so a token can't choose its own algorithm. */
export function idTokensWith(keys: Record<Provider, JWTVerifyGetKey>): IdTokens {
  return {
    async verify(provider, idToken) {
      const label = LABEL[provider];
      const refused = () => refuse(401, `That ${label} sign-in didn't work. Please try again.`);
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(idToken, keys[provider], {
          issuer: ISSUERS[provider],
          audience: audiencesOf(provider),
          algorithms: ["RS256"],
          requiredClaims: ["sub", "exp"],
        }));
      } catch (error) {
        if (error instanceof joseErrors.JWTClaimValidationFailed && error.claim === "aud") {
          // The audience is an app id, not a secret: it's what to add to the env list. It goes to Sentry as a tag, and the token doesn't.
          const aud = String((error as { payload?: { aud?: unknown } }).payload?.aud ?? "").slice(0, 200);
          Sentry.captureException(Object.assign(new Error("IdTokenAudienceRefused"), { name: "IdTokenAudienceRefused" }), { tags: { provider, aud } });
          throw refuse(503, `${label} sign-in isn't set up for this version yet. Try an invite link.`);
        }
        // A bare JOSEError is jose's "the key set didn't come back as 200 JSON"; anything that isn't jose's is a network failure.
        const keysDown =
          !(error instanceof joseErrors.JOSEError) ||
          error.constructor === joseErrors.JOSEError ||
          error instanceof joseErrors.JWKSTimeout ||
          error instanceof joseErrors.JWKSInvalid;
        if (!keysDown) throw refused();
        throw refuse(503, `We couldn't reach ${label} just now. Please try again.`);
      }
      const sub = typeof payload.sub === "string" ? payload.sub : "";
      if (!sub || sub.length > 255) throw refused();
      const email = typeof payload.email === "string" && payload.email.length <= 254 ? payload.email.toLowerCase() : null;
      const given = typeof payload.given_name === "string" ? payload.given_name.trim().slice(0, MAX_NAME) : "";
      return { provider, sub, email, givenName: given || null };
    },
  };
}

let current: IdTokens | undefined;

/** Fetched on first use and cached; jose fetches again when it meets a new key id. */
export function idTokens(): IdTokens {
  current ??= idTokensWith({
    apple: createRemoteJWKSet(new URL(KEY_URLS.apple), { timeoutDuration: KEYS_TIMEOUT_MS }),
    google: createRemoteJWKSet(new URL(KEY_URLS.google), { timeoutDuration: KEYS_TIMEOUT_MS }),
  });
  return current;
}

/** For tests. */
export function useIdTokens(next: IdTokens | undefined): void {
  current = next;
}

export const providerLabel = (provider: Provider) => LABEL[provider];
