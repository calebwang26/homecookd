// A card asked of a parent: made from her craving link through the kid's route, as the site makes one (POST /dish/cards with `cravingToken`).
import type { FastifyInstance } from "fastify";
import { call, ok, type Who } from "./communityHelpers.js";
import { clearWindow, makeCard, rowOf, store } from "./dishHelpers.js";

export async function cravingLink(t: FastifyInstance, who: Who, message?: string): Promise<{ url: string; token: string }> {
  const { url } = await ok(call(t, who, "POST", "/v1/cravings/link", message === undefined ? {} : { message }));
  return { url, token: new URL(url).searchParams.get("c")! };
}

export async function cravingCard(t: FastifyInstance, who: Who, body: Record<string, unknown> = { dish: "braised pork", kidName: "Caleb" }) {
  await clearWindow("dish-cards");
  const { token } = await cravingLink(t, who);
  const made = await makeCard(t, { ...body, cravingToken: token });
  return { ...made, token, row: await rowOf(made.kidToken) };
}

/** The link, and her bytes on S3: what the app does before it sends the key. */
export async function voiceUpload(t: FastifyInstance, who: Who, id: string, bytes = 400, type = "audio/mp4"): Promise<string> {
  const link = await ok(call(t, who, "POST", `/v1/cravings/${id}/voice-recipe/upload`, { contentType: type, size: bytes }));
  store.put(link.uploadUrl, new Uint8Array(bytes).fill(1), link.contentType);
  return link.audioKey;
}
