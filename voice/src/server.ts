// homecookd live voice service (docs/build/STACK.md, Track B). Runs on Cloud Run with min instances 1.
//   GET /health                                      → ok (Cloud Run's front end swallows /healthz)
//   WS  /cook?session=<sessionToken>&recipe=<recipeId>[&audio=pcm|wav]
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { Cooking } from "./cook.js";
import { usingStub } from "./convex.js";
import { env } from "./env.js";

const server = createServer((req, res) => {
  if (req.url === "/health" || req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://x");
  const token = url.searchParams.get("session");
  const recipe = url.searchParams.get("recipe");
  if (url.pathname !== "/cook" || !token || !recipe) {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    return;
  }
  const audio = url.searchParams.get("audio") === "wav" ? "wav" : "pcm";
  wss.handleUpgrade(req, socket, head, (ws) => {
    const cooking = new Cooking(ws, token, recipe, audio);
    ws.on("message", (data, isBinary) => cooking.onMessage(data, isBinary));
    ws.on("close", () => cooking.close());
    // Keep the socket alive through Cloud Run's front end while the kid is quiet.
    const ping = setInterval(() => ws.ping(), 25_000);
    ws.on("close", () => clearInterval(ping));
    void cooking.start();
  });
});

server.listen(env.port, () => {
  console.log(`voice service on :${env.port} (model ${env.claudeModel}, convex ${usingStub ? "STUB" : "live"})`);
});
