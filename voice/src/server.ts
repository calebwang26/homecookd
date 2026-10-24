// homecookd live voice service (docs/build/STACK.md, Tracks B and E). Runs on Cloud Run with min instances 1.
//   GET  /health                                          → ok (Cloud Run's front end swallows /healthz)
//   WS   /cook?session=<sessionToken>&recipe=<recipeId>[&audio=pcm|wav]       the kid cooking
//   WS   /record?session=<sessionToken>&recording=<recordingId>[&audio=pcm|wav]  homie while a cook records
//   POST /speak { sessionToken, text, lang?, translate? }  → audio/wav in homie's voice
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer } from "ws";
import { Cooking } from "./cook.js";
import * as convex from "./convex.js";
import { env } from "./env.js";
import { translate } from "./homie.js";
import { Recording } from "./record.js";
import { speakWav } from "./sonic.js";

const MAX_SPEAK_CHARS = 600;

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
  const { sessionToken, text, lang, translate: shouldTranslate } = body ?? {};
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
    const wav = await speakWav(spoken, { language, voice: env.homieVoice, speed: 0.9 });
    console.log(`speak ${language} ${Date.now() - t0}ms`);
    res.writeHead(200, { "Content-Type": "audio/wav", "Content-Length": wav.length, "x-spoken-text": encodeURIComponent(spoken) }).end(wav);
  } catch (err) {
    console.error("speak", (err as Error).message);
    fail(res, 502, "couldn't speak that");
  }
}

const server = createServer((req, res) => {
  const path = (req.url ?? "/").split("?")[0];
  if (path === "/health" || path === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
    return;
  }
  if (path === "/speak" && req.method === "POST") return void speakRoute(req, res);
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });

server.on("upgrade", (req, socket, head) => {
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
  wss.handleUpgrade(req, socket, head, (ws) => {
    const session = url.pathname === "/cook" ? new Cooking(ws, token, recipe!, audio) : new Recording(ws, token, recording!, audio);
    ws.on("message", (data, isBinary) => session.onMessage(data, isBinary));
    ws.on("close", () => session.close());
    // Keep the socket alive through Cloud Run's front end while nobody talks.
    const ping = setInterval(() => ws.ping(), 25_000);
    ws.on("close", () => clearInterval(ping));
    void session.start();
  });
});

server.listen(env.port, () => {
  console.log(`voice service on :${env.port} (model ${env.claudeModel}, convex ${convex.usingStub ? "STUB" : "live"}, homie demo ${env.homieDemo})`);
});
