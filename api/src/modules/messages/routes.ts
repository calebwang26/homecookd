// The messages area's routes: session-checked, under /v1. A route checks the input and who's asking; the rules are in the services. docs/build/MESSAGES-MIGRATION.md
// maps each old Convex function and Supabase route to one of these, and says what a poll reads.
//
// Field types live in the services, not the schemas, because Fastify's validator would quietly turn "4" into 4 (Supabase's rating refuses that). The schemas still name
// every field, so app.ts's file-key check can see them. Writes that create what someone wrote require an Idempotency-Key header; the rest honor one.
import type { FastifyInstance, FastifyRequest } from "fastify";
import { requireSession, signedIn } from "../../auth.js";
import { idempotencyKey } from "../../idempotency.js";
import { hit, subjectKey } from "../../rateLimit.js";
import { chatQuestionsOfDish, notesOfDish, openChatQuestions, removeNote, saveNoteByHand } from "./notes.js";
import * as activity from "./activity.js";
import { sharePhoto } from "./photoNote.js";
import * as pushTokens from "./pushTokens.js";
import { answer, ask, forRecipe, openForCook } from "./questions.js";
import { getRecap, getTable } from "./retention.js";
import * as service from "./service.js";
import { confirmUpload, makeUpload } from "./uploads.js";

const body = (...names: string[]) => ({ type: "object", properties: Object.fromEntries(names.map((name) => [name, {}])) });
const params = (name: string) => ({ type: "object", required: [name], properties: { [name]: { type: "string", maxLength: 200 } } });
const query = (r: FastifyRequest) => r.query as Record<string, unknown>;
const payload = (r: FastifyRequest) => r.body as Record<string, unknown>;
const param = (r: FastifyRequest, name: string) => (r.params as Record<string, string>)[name];
const write = (r: FastifyRequest, required: boolean) => ({ key: idempotencyKey(r, required), requestId: String(r.id) });

export async function messageRoutes(app: FastifyInstance): Promise<void> {
  const on = { preValidation: requireSession };

  // Threads
  app.get("/v1/threads", on, (r) => service.inbox(signedIn(r), query(r)));
  app.post("/v1/threads", { ...on, schema: { body: body("otherId") } }, (r) => service.startPair(signedIn(r), payload(r)));
  app.get("/v1/circle", on, (r) => service.circle(signedIn(r)));
  app.get("/v1/unread", on, (r) => service.unread(signedIn(r)));
  app.get("/v1/threads/:id/messages", { ...on, schema: { params: params("id") } }, (r) => service.threadPage(signedIn(r), param(r, "id"), query(r)));
  app.post(
    "/v1/threads/:id/messages",
    {
      ...on,
      schema: {
        params: params("id"),
        body: body("kind", "body", "libraryId", "stepOrder", "audioKey", "clipKey", "clipStartS", "clipEndS", "durationS", "transcript", "photoKey", "replyTo"),
      },
      config: { fileKeys: ["audioKey", "photoKey"], notFileKeys: ["clipKey"] },
    },
    (r) => service.sendToThread(signedIn(r), param(r, "id"), payload(r), write(r, true)),
  );
  app.post("/v1/threads/:id/read", { ...on, schema: { params: params("id") }, config: { noBody: true } }, (r) => service.readThread(signedIn(r), param(r, "id")));

  // Convex's messages
  app.get("/v1/messages", on, (r) => service.familyMessages(signedIn(r), query(r)));
  app.post(
    "/v1/messages",
    { ...on, schema: { body: body("kind", "text", "audioKey", "photoKey", "to", "recipeId", "aiDrafted") }, config: { fileKeys: ["audioKey", "photoKey"] } },
    (r) => service.sendToPerson(signedIn(r), payload(r), write(r, true)),
  );
  app.get("/v1/messages/made-my-dish", on, (r) => service.madeMyDish(signedIn(r)));
  app.post("/v1/messages/photo-note", { ...on, schema: { body: body("recipeId", "photoKey") }, config: { fileKeys: ["photoKey"] } }, (r) => sharePhoto(signedIn(r), payload(r)));
  app.post(
    "/v1/messages/:id/postcard",
    { ...on, schema: { params: params("id"), body: body("photoKey", "rating") }, config: { fileKeys: ["photoKey"] } },
    async (r) => {
      await hit(subjectKey(signedIn(r).personId), [{ bucket: "postcard", max: 60, windowS: 3600 }]);
      return await service.postcard(signedIn(r), param(r, "id"), payload(r), write(r, false));
    },
  );
  app.post("/v1/send-recipe", { ...on, schema: { body: body("libraryId", "note", "to") } }, (r) => service.sendRecipe(signedIn(r), payload(r), write(r, true)));

  // Files go straight to S3.
  app.post("/v1/uploads", { ...on, schema: { body: body("kind", "contentType", "size") } }, async (r, reply) => reply.status(201).send(await makeUpload(signedIn(r), payload(r))));
  // Not uploaded yet, so the guard can't apply: confirmUpload checks its own family, owner and state (messagesFiles.test.ts).
  app.post("/v1/uploads/confirm", { ...on, schema: { body: body("key") }, config: { notFileKeys: ["key"] } }, (r) => confirmUpload(signedIn(r), payload(r).key));

  // Questions asked in chat, and answers saved to a recipe
  app.get("/v1/chat-questions/open", on, (r) => openChatQuestions(signedIn(r)));
  app.get("/v1/dishes/:libraryId/chat-questions", { ...on, schema: { params: params("libraryId") } }, (r) => chatQuestionsOfDish(signedIn(r), param(r, "libraryId")));
  app.get("/v1/dishes/:libraryId/notes", { ...on, schema: { params: params("libraryId") } }, (r) => notesOfDish(signedIn(r), param(r, "libraryId"), query(r)));
  app.get("/v1/dishes/:libraryId/activity", { ...on, schema: { params: params("libraryId") } }, (r) => activity.dishActivity(signedIn(r), param(r, "libraryId")));
  app.post("/v1/notes", { ...on, schema: { body: body("messageId") } }, (r) => saveNoteByHand(signedIn(r), payload(r)));
  app.post("/v1/notes/:id/remove", { ...on, schema: { params: params("id") }, config: { noBody: true } }, (r) => removeNote(signedIn(r), param(r, "id")));

  // Questions while cooking
  app.post("/v1/questions", { ...on, schema: { body: body("recipeId", "stepOrder", "text", "found") } }, async (r, reply) =>
    reply.status(201).send(await ask(signedIn(r), payload(r), write(r, true))),
  );
  app.get("/v1/questions/open", on, (r) => openForCook(signedIn(r), query(r)));
  app.get("/v1/recipes/:recipeId/questions", { ...on, schema: { params: params("recipeId") } }, (r) => forRecipe(signedIn(r), param(r, "recipeId"), query(r)));
  app.post(
    "/v1/questions/:id/answer",
    { ...on, schema: { params: params("id"), body: body("text", "audioKey") }, config: { fileKeys: ["audioKey"] } },
    (r) => answer(signedIn(r), param(r, "id"), payload(r), write(r, true)),
  );

  // Share links
  app.post("/v1/shares", { ...on, schema: { body: body("libraryId") } }, (r) => activity.makeShare(signedIn(r), payload(r)));
  // Public: the link is the capability. Everything else here needs a session.
  app.post("/v1/shares/open", { schema: { body: body("token") } }, (r) => activity.openShare(payload(r).token, r.ip));

  // Recordings on their way
  app.post(
    "/v1/pending-sends",
    { ...on, schema: { body: body("uploadId", "recipientIds", "helloKey", "helloDurationS") }, config: { fileKeys: ["helloKey"] } },
    (r) => activity.registerPendingSend(signedIn(r), payload(r), write(r, true)),
  );
  app.post("/v1/pending-sends/:uploadId/published", { ...on, schema: { params: params("uploadId"), body: body("libraryId") } }, (r) =>
    activity.publishedFromPhone(signedIn(r), param(r, "uploadId"), payload(r), String(r.id)),
  );

  // What people do with a recipe
  app.post("/v1/events", { ...on, schema: { body: body("libraryId", "kind", "cookId", "durationS", "startS") } }, (r) => activity.recordEvent(signedIn(r), payload(r)));
  app.get("/v1/favorites", on, (r) => activity.favorites(signedIn(r), query(r)));
  app.post("/v1/favorites", { ...on, schema: { body: body("libraryId", "on") } }, (r) => activity.setFavorite(signedIn(r), payload(r)));
  app.get("/v1/me/recipe-stats", on, (r) => activity.myRecipeStats(signedIn(r), query(r)));
  app.get("/v1/dish-stats", on, (r) => activity.dishStats(signedIn(r), query(r)));
  app.get("/v1/hearts/recent", on, (r) => activity.heartsRecent(signedIn(r), query(r)));
  app.get("/v1/table", on, (r) => getTable(signedIn(r), r));
  app.get("/v1/recap", on, (r) => getRecap(signedIn(r), query(r)));

  // Push tokens
  app.post("/v1/push-tokens", { ...on, schema: { body: body("token", "platform", "tz") } }, (r) => pushTokens.register(signedIn(r), payload(r)));
  app.post("/v1/push-tokens/remove", { ...on, schema: { body: body("token") } }, (r) => pushTokens.unregister(signedIn(r), payload(r)));
}
