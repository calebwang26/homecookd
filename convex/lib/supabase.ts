// The sign-in bridge's only call to Supabase (frozen, docs/build/API.md "Auth"). Everything Convex
// knows about who someone is comes through here, so a stub or a new backend changes this one file.
import { ConvexError } from "convex/values";

const DEFAULT_API = "https://bsudybxsqvtwftsdmwmz.supabase.co/functions/v1/api";

export type SupabaseProfile = {
  id: string;
  name: string;
  role: "cook" | "learner";
  invited?: boolean;
  locked?: boolean;
  memorial?: boolean;
};
export type SupabaseFamily = { family: { id: string; name: string }; profiles: SupabaseProfile[] };

/** `GET /family` as this phone and this person. Throws the server's own error text (it's written for people). */
export async function fetchFamily(deviceKey: string, profileId: string): Promise<SupabaseFamily> {
  const base = (process.env.SUPABASE_API_URL || DEFAULT_API).replace(/\/+$/, "");
  let res: Response;
  try {
    res = await fetch(`${base}/family`, {
      headers: { "x-device-key": deviceKey, "x-profile-id": profileId },
    });
  } catch {
    throw new ConvexError("Couldn't reach sign-in. Try again soon.");
  }
  const body = (await res.json().catch(() => null)) as
    | (Partial<SupabaseFamily> & { error?: string })
    | null;
  if (!res.ok) throw new ConvexError(body?.error || `Sign-in failed (${res.status}).`);
  if (!body?.family?.id || !Array.isArray(body.profiles)) throw new ConvexError("Sign-in sent something odd.");
  return { family: body.family, profiles: body.profiles };
}
