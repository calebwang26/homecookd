// Recoverable secrets, sealed: a family's code (families.code_enc) and a join link's token (join_links.token_enc), so "Invite family" shows the same link all
// week. 'v1:' + base64(iv) + '.' + base64(ciphertext), AES-GCM with a key derived per purpose. Same format, salts and additional data as Supabase, so a row
// copied across opens here when EDIBLE_CODE_KEY is the same key (docs/build/ACCOUNTS-MIGRATION.md, "Secrets"). There's no fallback key: unset, sealing refuses.
const enc = new TextEncoder();
const dec = new TextDecoder();
const keys = new Map<string, Promise<CryptoKey>>();

export const FAMILY_CODE_SALT = "homecookd-family-code-v1";
export const JOIN_LINK_SALT = "homecookd-join-link-v1";

function aesKey(salt: string): Promise<CryptoKey> {
  const secret = process.env.EDIBLE_CODE_KEY?.trim();
  if (!secret) throw new Error("EDIBLE_CODE_KEY isn't set");
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
