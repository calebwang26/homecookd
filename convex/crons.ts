import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("purge expired sessions", { hours: 1 }, internal.sessions.purgeExpired, {});
crons.interval("end idle cooking sessions", { minutes: 15 }, internal.cooking.endIdle, {});
export default crons;
