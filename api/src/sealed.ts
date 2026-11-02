// Recoverable secrets, sealed, so the app can show the same one again while a copy of the database alone opens nothing: a family's code (families.code_enc), a join
// link's token (join_links.token_enc), a craving link's (craving_links.token_enc), a dinner's invite (dinners.invite_token_enc) and a share link's (shares.token_enc).
// 'v1:' + base64(iv) + '.' + base64(ciphertext), AES-GCM with a key derived per purpose and the row's id as additional data. The first two use Supabase's format, salts
// and additional data, so a row copied across opens here when EDIBLE_CODE_KEY is the same key (docs/build/ACCOUNTS-MIGRATION.md, "Secrets"). There's no fallback key:
// unset, sealing refuses and nothing opens.
import { createHmac, hkdfSync } from "node:crypto";

const enc = new TextEncoder();
const dec = new TextDecoder();
const keys = new Map<string, Promise<CryptoKey>>();

export const FAMILY_CODE_SALT = "homecookd-family-code-v1";
export const JOIN_LINK_SALT = "homecookd-join-link-v1";
export const CRAVING_LINK_SALT = "homecookd-craving-link-v1";
export const DINNER_INVITE_SALT = "homecookd-dinner-invite-v1";
export const SHARE_LINK_SALT = "homecookd-share-link-v1";
const SHARE_LOOKUP_SALT = "homecookd-share-lookup-v1";

function secretOf(): string {
  const secret = process.env.EDIBLE_CODE_KEY?.trim();
  if (!secret) throw new Error("EDIBLE_CODE_KEY isn't set");
  return secret;
}

function aesKey(salt: string): Promise<CryptoKey> {
  const secret = secretOf();
  const id = `${secret}:${salt}`;
  let key = keys.get(id);
  if (!key) {
    key = (async () => {
      const base = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"]);
      return crypto.subtle.deriveKey(
        { name: "HKDF", hash: "SHA-256", salt: enc.encode(salt), info: new Uint8Array() },
        base,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );
    })();
    keys.set(id, key);
  }
  return key;
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

export async function seal(salt: string, aad: string, text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(aad) }, await aesKey(salt), enc.encode(text));
  return `v1:${b64(iv)}.${b64(new Uint8Array(ct))}`;
}

/** Null when it can't be opened: a wrong or rotated key, or a damaged row. */
export async function unseal(salt: string, aad: string, sealed: string | null): Promise<string | null> {
  if (!sealed?.startsWith("v1:")) return null;
  try {
    const [iv, ct] = sealed.slice(3).split(".");
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: Buffer.from(iv, "base64"), additionalData: enc.encode(aad) },
      await aesKey(salt),
      Buffer.from(ct, "base64"),
    );
    return dec.decode(plain);
  } catch {
    return null;
  }
}

/**
 * What a share link is looked up by. Its token is the old apps' 10 characters, few enough that a copy of the database could be searched for plain sha256s, so this
 * hash is keyed, with its own key from the same secret. Longer tokens (22 characters and up) are looked up by plain sha256, as sessions and join links are.
 */
export function shareTokenHash(token: string): string {
  const key = Buffer.from(hkdfSync("sha256", secretOf(), SHARE_LOOKUP_SALT, "", 32));
  return createHmac("sha256", key).update(token).digest("hex");
}
