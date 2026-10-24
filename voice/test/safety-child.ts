// Run by server.test.ts in a process of its own: the safety net with one session's rejected promise (it must keep
// serving) and, with "throw", another session's uncaught exception (it must log and exit).
import { inSession, installSafetyNet } from "../src/safety.js";

installSafetyNet();
inSession("cook-7", () => void Promise.reject(new Error("one kid's turn failed")));
setTimeout(() => console.log("still serving"), 50);
if (process.argv[2] === "throw") {
  setTimeout(() => inSession("cook-8", () => setTimeout(() => { throw new Error("a bug"); }, 0)), 100);
} else {
  setTimeout(() => process.exit(0), 150);
}
