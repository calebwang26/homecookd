// The process-level safety net (server.ts installs it) and which session an error belongs to. One process serves
// every kid and cook on the instance, so one session's mistake must never end the others'.
import { AsyncLocalStorage } from "node:async_hooks";

const current = new AsyncLocalStorage<string>();
const who = () => current.getStore() ?? "no session";

/** Runs `fn` as session `id`: the timers, promises and sockets it starts carry the id into the logs below. */
export const inSession = <T>(id: string, fn: () => T): T => current.run(id, fn);

/** An event handler for session `id`: runs as that session, and a throw is logged instead of ending the process. */
export function guarded<A extends unknown[]>(id: string, what: string, fn: (...args: A) => void): (...args: A) => void {
  return (...args) =>
    current.run(id, () => {
      try {
        fn(...args);
      } catch (err) {
        console.error(`[${id}] ${what} threw:`, err);
      }
    });
}

/**
 * A rejected promise nobody caught is logged with its session and never stops the process. An uncaught exception
 * is logged and the process exits, so Cloud Run starts a clean one. `exit` is for the tests.
 */
export function installSafetyNet(exit: (code: number) => void = (code) => process.exit(code)) {
  process.on("unhandledRejection", (reason) => console.error(`unhandled rejection [${who()}]:`, reason));
  process.on("uncaughtException", (err, origin) => {
    // With --unhandled-rejections=strict a rejection comes here first, then to the handler above, which logs it.
    if (origin === "unhandledRejection") return;
    console.error(`uncaught exception [${who()}], exiting:`, err);
    exit(1);
  });
}
