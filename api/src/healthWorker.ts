// The health check's own thread (health.ts). It loads nothing of the api's: all it knows is the time the main thread last wrote.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { parentPort, workerData } from "node:worker_threads";

const { beat, port, host, staleMs } = workerData as { beat: BigInt64Array; port: number; host: string; staleMs: number };

const server = createServer((req, res) => {
  if (req.url?.split("?")[0] !== "/health" || (req.method !== "GET" && req.method !== "HEAD")) {
    res.writeHead(404).end();
    return;
  }
  const fresh = Date.now() - Number(Atomics.load(beat, 0)) < staleMs;
  res.writeHead(fresh ? 200 : 503, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }).end(fresh ? "ok" : "stuck");
});

// A port that's taken throws here, which rejects startHealthResponder.
server.listen(port, host, () => parentPort?.postMessage({ port: (server.address() as AddressInfo).port }));
