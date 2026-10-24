// homie's live recording routes, called by the voice service with x-voice-secret (STACK.md,
// "homie (Oct 24)"). Track E fills these in; http.ts only registers them.
import type { HttpRouter } from "convex/server";

export function registerLiveRoutes(_http: HttpRouter): void {}
