// Other tables have no FK to `files`, because a key can also name public library media (SCHEMA.md). So this check is the only
// thing stopping someone attaching another family's file, and then deleting it with their own account's purge.
//
// It can't be forgotten: app.ts refuses to register a route with a key-like field anywhere in its body, querystring or params
// unless it declares config.fileKeys or config.notFileKeys, or a write route with no body schema unless it says config.noBody. It
// adds this check to every declared field. Paths: `audioKey`, `attachments[].photoKey`, `query.audioKey`, `params.key`.
import type { FastifyRequest } from "fastify";
import { signedIn } from "./auth.js";
import { db } from "./db.js";
import { notFound } from "./errors.js";

/**
 * Field names that may hold a file. Deliberately wide: a false match only makes a route say config.notFileKeys. The limit: this
 * goes by name, so a field called something unrelated, like `attachment`, isn't caught, and neither is a shape the schema doesn't
 * describe (the route never sees those as typed fields). Name file fields with one of these words.
 */
export const looksLikeFileKey = (field: string) =>
  /(^|_)(keys?|paths?|files?|file_?ids?|storage_?ids?|uploads?|photos?|voice_?notes?|clips?|audio)$/i.test(field) ||
  /[a-z0-9](Keys?|Paths?|Files?|FileIds?|StorageIds?|Uploads?|Photos?|VoiceNotes?|Clips?|Audio)$/.test(field);

type Schema = {
  properties?: Record<string, Schema>;
  items?: Schema;
  additionalProperties?: Schema | boolean;
  oneOf?: Schema[];
  anyOf?: Schema[];
  allOf?: Schema[];
};

/** Every field a schema describes, as a path: `audioKey`, `attachments[].photoKey`. */
export function fieldPaths(schema: Schema | undefined, prefix = ""): string[] {
  if (!schema || typeof schema !== "object") return [];
  const nested = Object.entries(schema.properties ?? {}).flatMap(([name, child]) => {
    const path = prefix + name;
    return [path, ...fieldPaths(child, `${path}.`)];
  });
  const strip = prefix.endsWith(".") ? prefix.slice(0, -1) : prefix;
  const items = schema.items ? fieldPaths(schema.items, `${strip}[].`) : [];
  const open =
    typeof schema.additionalProperties === "object" ? fieldPaths(schema.additionalProperties, `${strip}{}.`) : [];
  const variants = [...(schema.oneOf ?? []), ...(schema.anyOf ?? []), ...(schema.allOf ?? [])].flatMap((s) =>
    fieldPaths(s, prefix),
  );
  return [...new Set([...nested, ...items, ...open, ...variants])];
}

/** The last word of a path, which is what's named like a key: `attachments[].photoKey` is `photoKey`. */
export const lastName = (path: string) => path.split(/\.|\[\]|\{\}/).filter(Boolean).at(-1) ?? path;

/** Whatever a path holds, through arrays and open objects. `query.` and `params.` paths read from there; others from the body. */
export function valuesAt(root: unknown, path: string): unknown[] {
  let current: unknown[] = [root];
  for (const step of path.split(".")) {
    const open = step.endsWith("{}");
    const array = step.endsWith("[]");
    const name = step.replace(/(\[\]|\{\})$/, "");
    current = current.flatMap((value) => {
      if (value === null || typeof value !== "object") return [];
      const next = name ? (value as Record<string, unknown>)[name] : value;
      if (next === undefined || next === null) return [];
      if (array) return Array.isArray(next) ? next : [next];
      if (open) return typeof next === "object" ? Object.values(next as object) : [next];
      return [next];
    });
  }
  return current;
}

/**
 * A file must be the caller's family's, and the caller's own when it has an owner: a family check alone would let one member attach another's upload, and
 * then purging the second account would delete the first's file. Refusing a file something already holds needs the row it's going on, so the route's
 * service does that, under that row's lock (dish/cravings.ts).
 */
export async function requireOwnFiles(familyId: string, personId: string, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const unique = [...new Set(keys)];
  const { rows } = await db().query(
    `select key from files
      where key = any($1::text[])
        and family_id = $2
        and (owner_person_id is null or owner_person_id = $3)
        and uploaded_at is not null
        and deleted_at is null
        and delete_requested_at is null`,
    [unique, familyId, personId],
  );
  if (rows.length !== unique.length) throw notFound();
}

export function fileGuard(fields: string[]) {
  return async (req: FastifyRequest): Promise<void> => {
    const keys = fields.flatMap((field) => {
      if (field.startsWith("query.")) return valuesAt(req.query, field.slice(6));
      if (field.startsWith("params.")) return valuesAt(req.params, field.slice(7));
      return valuesAt(req.body ?? {}, field);
    }).flatMap((value) => (Array.isArray(value) ? value : [value]));
    if (keys.some((key) => typeof key !== "string")) throw notFound();
    const signed = signedIn(req);
    await requireOwnFiles(signed.familyId, signed.personId, keys as string[]);
  };
}
