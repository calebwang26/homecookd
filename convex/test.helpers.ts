/// <reference types="vite/client" />
// Shared setup for the convex-test suites (two dots in the name, so Convex doesn't deploy it).
import { convexTest } from "convex-test";
import { vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

export const modules = import.meta.glob("./**/*.ts");
export const newBackend = () => convexTest(schema, modules);
export type Backend = ReturnType<typeof newBackend>;

export const FAMILY = {
  family: { id: "fam-1", name: "The Wangs" },
  profiles: [
    { id: "p-dad", name: "Dad", role: "cook" },
    { id: "p-leo", name: "Leo", role: "learner" },
    { id: "p-mom", name: "Mom", role: "cook", locked: true },
    { id: "p-amy", name: "Amy", role: "learner", invited: true },
  ],
};

export const CLAUDE = "https://api.anthropic.com/v1/messages";

/** A Claude Messages API reply holding `text` (lib/textModel.ts reads its content and stop_reason). */
export const claudeReply = (text: string, stop_reason = "end_turn") =>
  Response.json({
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content: [{ type: "text", text }],
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  });

type Route = (url: string, init?: RequestInit) => Response | Promise<Response> | undefined;

/** Stubs global fetch. Each route may answer; Supabase GET /family answers with `family` by default. */
export function stubFetch(family: unknown = FAMILY, ...routes: Route[]) {
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    for (const r of routes) {
      const res = await r(url, init);
      if (res) return res;
    }
    if (url.endsWith("/family")) return Response.json(family);
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

export async function signIn(t: Backend, profileId: string) {
  return await t.action(api.sessions.start, { deviceKey: "k".repeat(43), profileId });
}

/** A ready recipe for Dad with two steps and one story. */
export async function addRecipe(t: Backend, familyId: string, cookId: string, memoriesOptIn = true) {
  return await t.run(async (ctx) =>
    ctx.db.insert("recipes", {
      familyId: familyId as never,
      cookId: cookId as never,
      title: "Sunday Chili",
      status: "ready",
      steps: [
        { order: 1, title: "Brown the beef", text: "Brown it hard.", quote: "Let it argue with you.", moment: { startS: 60, endS: 330 } },
        { order: 2, title: "Add the beans", text: "Add the beans.", moment: { startS: 400, endS: 500 } },
      ],
      memories: [{ kind: "story", text: "My first apartment had one pot.", moment: { startS: 130, endS: 230 } }],
      memoriesOptIn,
    }),
  );
}
