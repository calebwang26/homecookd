// The whole service in a child process (stub recipe, fake speech, no network): each input that used to end the
// process, then /health must still answer. And the safety net on its own: a rejected promise is logged with its
// session and the process keeps serving; an uncaught exception is logged and the process exits.
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { request } from "node:http";
import { connect, createServer } from "node:net";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const voice = fileURLToPath(new URL("..", import.meta.url));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let port = 0;
let child: ChildProcess;
let log = "";

async function freePort(): Promise<number> {
  const s = createServer().listen(0);
  await new Promise((r) => s.once("listening", r));
  const { port } = s.address() as { port: number };
  await new Promise((r) => s.close(r));
  return port;
}

const health = () =>
  new Promise<number | string>((resolve) => {
    const req = request({ host: "127.0.0.1", port, path: "/health" }, (res) => (res.resume(), resolve(res.statusCode ?? 0)));
    req.on("error", (err: NodeJS.ErrnoException) => resolve(err.code ?? "error"));
    req.end();
  });

before(async () => {
  port = await freePort();
  child = spawn(process.execPath, ["--import", "tsx", "--unhandled-rejections=strict", "src/server.ts"], {
    cwd: voice,
    env: {
      ...process.env,
      PORT: String(port),
      VOICE_STUB: "1",
      VOICE_FAKE_SPEECH: "1",
      CARTESIA_API_KEY: "test",
      ANTHROPIC_API_KEY: "test",
      // Anything that still tries the network fails fast, locally.
      ANTHROPIC_BASE_URL: "http://127.0.0.1:9",
      GLASSES_URL: "http://127.0.0.1:9",
    },
  });
  child.stdout!.on("data", (d) => (log += d));
  child.stderr!.on("data", (d) => (log += d));
  for (let i = 0; i < 100 && (await health()) !== 200; i++) await sleep(100);
  assert.equal(await health(), 200, `the service didn't start:\n${log}`);
});
after(() => void child.kill());

/** Still up: /health answers and the process hasn't exited. */
async function survives(what: string) {
  await sleep(500);
  assert.equal(child.exitCode, null, `${what} ended the process:\n${log}`);
  assert.equal(await health(), 200, what);
}

/** A socket to the service; fails (never hangs) when the service is down. */
async function socket(path: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
  await new Promise((resolve, reject) => (ws.once("open", resolve), ws.once("error", reject)));
  ws.on("error", () => {});
  return ws;
}

async function raw() {
  const s = connect(port, "127.0.0.1");
  await new Promise((resolve, reject) => (s.once("connect", resolve), s.once("error", reject)));
  s.on("error", () => {});
  return s;
}

test('a text frame "null" on /cook and on /record', async () => {
  const cook = await socket("/cook?session=t&recipe=grandma-red-braised-pork");
  cook.send("null");
  const record = await socket("/record?session=t&recording=stub-en");
  await sleep(300); // past loading, so the frame is read at once
  record.send("null");
  await survives('"null"');
  cook.close();
  record.close();
});

test("a frame over the 1 MiB limit", async () => {
  const ws = await socket("/cook?session=t&recipe=grandma-red-braised-pork");
  ws.send(Buffer.alloc(2 << 20));
  await survives("a 2 MiB frame");
  ws.close();
});

test("a text frame that isn't UTF-8", async () => {
  const s = await raw();
  s.write(
    "GET /cook?session=t&recipe=grandma-red-braised-pork HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n",
  );
  await sleep(200);
  const mask = [1, 2, 3, 4];
  s.write(Buffer.from([0x81, 0x83, ...mask, ...[0xff, 0xfe, 0xfd].map((b, i) => b ^ mask[i])]));
  await survives("bad UTF-8");
  s.destroy();
});

test("POST /speak that hangs up halfway through its body", async () => {
  const req = request({ host: "127.0.0.1", port, path: "/speak", method: "POST", headers: { "Content-Length": 5000 } });
  req.on("error", () => {});
  req.write('{"sessionToken":"t","text":"hel');
  await sleep(200);
  req.destroy();
  await survives("an aborted /speak");
});

test("an upgrade we refuse (no recipe), reset by the client", async () => {
  const s = await raw();
  s.write("GET /cook?session=t HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n");
  s.resetAndDestroy();
  await survives("a reset after our 400");
});

const runChild = (flags: string[], mode: string) =>
  spawnSync(process.execPath, ["--import", "tsx", ...flags, "test/safety-child.ts", mode], { cwd: voice, encoding: "utf8" });

test("safety net: a rejected promise is logged with its session, and the process keeps serving (also under strict)", () => {
  for (const flags of [[], ["--unhandled-rejections=strict"]]) {
    const r = runChild(flags, "reject");
    assert.equal(r.status, 0, `${flags}: ${r.stderr}`);
    assert.match(r.stdout, /still serving/);
    assert.equal(r.stderr.match(/unhandled rejection \[cook-7\]: Error: one kid's turn failed/g)?.length, 1, r.stderr);
  }
});

test("safety net: an uncaught exception is logged with its session, and the process exits for a clean restart", () => {
  const r = runChild([], "throw");
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /still serving/);
  assert.match(r.stderr, /uncaught exception \[cook-8\], exiting: Error: a bug/);
});
