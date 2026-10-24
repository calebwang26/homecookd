// homecookd live voice service (docs/build/STACK.md, Tracks B and E). Runs on Cloud Run with min instances 1.
//   GET  /health                                          → ok (Cloud Run's front end swallows /healthz)
//   WS   /cook?session=<sessionToken>&recipe=<recipeId>[&audio=pcm|wav]       the kid cooking
//   WS   /record?session=<sessionToken>&recording=<recordingId>[&audio=pcm|wav]  homie while a cook records
//   POST /speak { sessionToken, text, lang?, translate?, kind? }  → audio/wav in homie's voice
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import { Cooking } from "./cook.js";
import * as convex from "./convex.js";
import { env } from "./env.js";
import { translate } from "./homie.js";
import { Recording } from "./record.js";
import { guarded, inSession, installSafetyNet } from "./safety.js";
import { fakeSpeech, speakWav } from "./speech.js";

installSafetyNet();

const MAX_SPEAK_CHARS = 600;
let sessionCount = 0;

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 20_000) return null;
  }
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const fail = (res: ServerResponse, status: number, error: string) =>
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify({ error }));

/** Walkie-talkie and the pot's tap hints: a line in homie's voice, in `lang` or the person's language. */
async function speakRoute(req: IncomingMessage, res: ServerResponse) {
  const body = await readJson(req);
  const { sessionToken, text, lang, translate: shouldTranslate, kind } = body ?? {};
  if (typeof sessionToken !== "string" || typeof text !== "string" || !text.trim() || text.length > MAX_SPEAK_CHARS) {
    return fail(res, 400, `sessionToken and text (1–${MAX_SPEAK_CHARS} characters) are required`);
  }
  if (lang !== undefined && (typeof lang !== "string" || !/^[a-z]{2,3}$/.test(lang))) return fail(res, 400, "lang must be a code like mr or en");
  let person: convex.Person;
  try {
    person = await convex.person(sessionToken);
  } catch (err) {
    if (err instanceof convex.Unauthorized) return fail(res, 401, "signed out");
    console.error("speak person", (err as Error).message);
    return fail(res, 502, "couldn't check the session");
  }
  const language = (lang as string | undefined) ?? person.language ?? "en";
  try {
    const t0 = Date.now();
    const spoken = shouldTranslate === true && language !== "en" ? (await translate(text, language)) || text : text;
    // `kind` (optional, a `say` kind like "step" or "hint") picks the mood of an English line; none = content.
    const wav = await speakWav(spoken, { language, voice: env.homieVoice, kind: typeof kind === "string" ? kind.slice(0, 24) : undefined });
    console.log(`speak ${language} ${Date.now() - t0}ms`);
    res.writeHead(200, { "Content-Type": "audio/wav", "Content-Length": wav.length, "x-spoken-text": encodeURIComponent(spoken) }).end(wav);
  } catch (err) {
    console.error("speak", (err as Error).message);
    fail(res, 502, "couldn't speak that");
  }
}

/** Exported for the tests (PORT=0 picks a free port). */
export const server = createServer((req, res) => {
  const path = (req.url ?? "/").split("?")[0];
  if (path === "/health" || path === "/healthz") {
    // x-fake-speech tells the test clients this service spends no Cartesia credits.
    res.writeHead(200, { "Content-Type": "text/plain", ...(fakeSpeech ? { "x-fake-speech": "1" } : {}) }).end("ok");
    return;
  }
  if (path === "/speak" && req.method === "POST") {
    // A caller that hangs up mid-body makes reading it throw ("aborted").
    return void speakRoute(req, res).catch((err) => {
      console.warn("speak:", (err as Error).message);
      if (!res.headersSent) fail(res, 400, "couldn't read the request");
      else res.destroy();
    });
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });

server.on("upgrade", (req, socket, head) => {
  // Node hands the raw socket over with no 'error' listener: a client that resets it (say, after our 400) would
  // otherwise end the process. The WebSocket adds its own once it takes over.
  socket.on("error", (err) => console.warn("upgrade socket:", err.message));
  const url = new URL(req.url ?? "/", "http://x");
  const token = url.searchParams.get("session");
  const recipe = url.searchParams.get("recipe");
  const recording = url.searchParams.get("recording");
  const ok = token && ((url.pathname === "/cook" && recipe) || (url.pathname === "/record" && recording));
  if (!ok) {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    return;
  }
  const audio = url.searchParams.get("audio") === "wav" ? "wav" : "pcm";
  // "cook-12": in every log line the safety net writes for this socket's errors.
  const id = `${url.pathname.slice(1)}-${++sessionCount}`;
  wss.handleUpgrade(req, socket, head, (ws) =>
    inSession(id, () => {
      const session = url.pathname === "/cook" ? new Cooking(ws, token, recipe!, audio) : new Recording(ws, token, recording!, audio);
      ws.on("message", guarded(id, "message", (data: WebSocket.RawData, isBinary: boolean) => session.onMessage(data, isBinary)));
      ws.on("close", guarded(id, "close", () => session.close()));
      // A bad frame (over maxPayload, text that isn't UTF-8) is an 'error' here, and ws then closes the socket.
      // With no listener it would end the process.
      ws.on("error", (err) => console.warn(`[${id}] socket: ${err.message}`));
      // Keep the socket alive through Cloud Run's front end while nobody talks.
      const ping = setInterval(() => ws.ping(), 25_000);
      ws.on("close", () => clearInterval(ping));
      session.start().catch((err) => {
        console.error(`[${id}] start failed:`, err);
        ws.close(1011);
      });
    }),
  );
});

server.listen(env.port, () => {
  console.log(`voice service on :${env.port} (model ${env.claudeModel}, convex ${convex.usingStub ? "STUB" : "live"}, homie demo ${env.homieDemo}${fakeSpeech ? ", FAKE SPEECH: no Cartesia" : ""})`);
});
