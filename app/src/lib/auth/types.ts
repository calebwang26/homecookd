// Shared shapes for the native sign-in helpers (apple.ts, google.ts) and SessionProvider.

/**
 * What Apple or Google hands back: the id token for POST /auth/apple|google and, when the person
 * shared it, a name to prefill "What does your family call you?". Never log or store the token.
 */
export type ProviderSignIn = { idToken: string; name: string | null };

/** A sign-in that didn't finish, with a sentence that is safe to show people as is. */
export class SignInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SignInError';
  }
}

/** The error code an Expo or React Native native module rejected with ('' when there is none). */
export function nativeCode(e: unknown): string {
  return e && typeof e === 'object' && typeof (e as { code?: unknown }).code === 'string' ? (e as { code: string }).code : '';
}
