// A card asked of a parent: made through the kid's route, then tied to her with SQL, because `cravingToken` on POST /dish/cards still waits (COMMUNITY-MIGRATION.md).
import type { FastifyInstance } from "fastify";
import { db } from "../src/db.js";
import { sha256Hex } from "../src/modules/dish/values.js";
import { call, ok, type Who } from "./communityHelpers.js";
import { clearWindow, makeCard, rowOf, store } from "./dishHelpers.js";

export async function cravingLink(t: FastifyInstance, who: Who, message?: string): Promise<{ url: string; token: string }> {
  const { url } = await ok(call(t, who, "POST", "/v1/cravings/link", message === undefined ? {} : { message }));
  return { url, token: new URL(url).searchParams.get("c")! };
}

export async function cravingCard(t: FastifyInstance, who: Who, body: Record<string, unknown> = { dish: "braised pork", kidName: "Caleb" }) {
  await clearWindow("dish-cards");
  const made = await makeCard(t, body);
  const { token } = await cravingLink(t, who);
  await db().query(
    `update dish_asks set family_id = $2, requested_of = $3, cook_claimed_at = now(), craving_id = (select id from craving_links where token_hash = $4) where id = $1`,
    [(await rowOf(made.kidToken)).id, who.familyId, who.personId, sha256Hex(token)],
  );
  return { ...made, row: await rowOf(made.kidToken) };
}

/** The link, and her bytes on S3: what the app does before it sends the key. */
export async function voiceUpload(t: FastifyInstance, who: Who, id: string, bytes = 400, type = "audio/mp4"): Promise<string> {
  const link = await ok(call(t, who, "POST", `/v1/cravings/${id}/voice-recipe/upload`, { contentType: type, size: bytes }));
  store.put(link.uploadUrl, new Uint8Array(bytes).fill(1), link.contentType);
  return link.audioKey;
}
