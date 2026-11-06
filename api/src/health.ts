// The load balancer's health check, answered from its own thread on its own port (HEALTH_PORT; AWS-MIGRATION.md, "Load test with autoscaling, Nov 2").
// On Nov 2 a saturated task was still answering requests, but its /health waited in the event loop behind that work, missed three checks, and ECS
// replaced it in the middle of the test, cutting capacity just when it was short. A worker thread has its own event loop, so a busy main loop doesn't
// delay this answer. What it reports is whether the main loop still turns: the main thread writes the time into shared memory every BEAT_MS, and the
// answer is 200 while that is under STALE_MS old and 503 after. A saturated loop still reaches its timer every few seconds; a stuck one never does.
// /health on the main port stays, for the deploy's smoke test and for people.
import { Worker } from "node:worker_threads";

export const BEAT_MS = 1_000;
export const STALE_MS = 30_000;

export type HealthOptions = {
  port: number;
  host?: string;
  staleMs?: number;
  beatMs?: number;
  /** Beats only while this holds. The api passes whether its server is listening, so a task that has stopped serving goes 503 as well. */
  alive?: () => boolean;
  /** The thread stopped by itself after it started. The load balancer then gets no answer, and ECS replaces the task. */
  onStop?: (error: Error) => void;
};

export type HealthResponder = { port: number; stop: () => Promise<void> };

/** Resolves once the thread is listening, with the port it got (0 picks a free one); rejects when it can't listen. */
export async function startHealthResponder(options: HealthOptions): Promise<HealthResponder> {
  const beat = new BigInt64Array(new SharedArrayBuffer(BigInt64Array.BYTES_PER_ELEMENT));
  const alive = options.alive ?? (() => true);
  Atomics.store(beat, 0, BigInt(Date.now()));
  const timer = setInterval(() => {
    if (alive()) Atomics.store(beat, 0, BigInt(Date.now()));
  }, options.beatMs ?? BEAT_MS);
  timer.unref();

  const worker = new Worker(new URL("./healthWorker.js", import.meta.url), {
    workerData: { beat, port: options.port, host: options.host ?? "0.0.0.0", staleMs: options.staleMs ?? STALE_MS },
  });
  let done = false; // stopped on purpose, or already reported
  const report = (error: Error) => {
    if (done) return;
    done = true;
    options.onStop?.(error);
  };
  try {
    const port = await new Promise<number>((resolve, reject) => {
      worker.once("message", (m: { port: number }) => resolve(m.port));
      worker.once("error", reject);
      worker.once("exit", (code) => reject(new Error(`the health thread stopped before it listened (${code})`)));
    });
    worker.on("error", report);
    worker.on("exit", (code) => report(new Error(`the health thread stopped (${code})`)));
    worker.unref();
    return {
      port,
      stop: async () => {
        done = true;
        clearInterval(timer);
        await worker.terminate();
      },
    };
  } catch (error) {
    clearInterval(timer);
    await worker.terminate();
    throw error;
  }
}
