import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("purge expired sessions", { hours: 1 }, internal.sessions.purgeExpired, {});
crons.interval("end idle cooking sessions", { minutes: 15 }, internal.cooking.endIdle, {});
crons.interval("abandon idle recordings", { minutes: 15 }, internal.live.abandonIdle, {});
crons.interval("restart stopped account purges", { minutes: 30 }, internal.account.restartPurges, {});
export default crons;
