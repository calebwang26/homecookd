// The api: a route checks the input and who's asking, a service holds the rules, data access holds the SQL.
// Every log line carries the request id, which a caller can pass in and which goes back on the response.
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import * as Sentry from "@sentry/node";
import { appCors } from "./cors.js";
import { db, isPoolWait } from "./db.js";
import { ApiError, errorBody, invalid, noRoute, sendError, unavailable } from "./errors.js";
import { fieldPaths, fileGuard, lastName, looksLikeFileKey } from "./files.js";
import { accountRoutes } from "./modules/accounts/routes.js";
import { inviteRoutes } from "./modules/community/inviteRoutes.js";
import { communityRoutes } from "./modules/community/routes.js";
import { cravingRoutes } from "./modules/dish/cravingRoutes.js";
import { dishRoutes } from "./modules/dish/routes.js";
import { liveRoutes } from "./modules/live/routes.js";
import { messageRoutes } from "./modules/messages/routes.js";
import { peopleRoutes } from "./modules/people/routes.js";
import { platformRoutes } from "./modules/platform/routes.js";
import { jobRoutes } from "./modules/jobs/routes.js";
import { recipeRoutes } from "./modules/recipes/routes.js";
import { recordingRoutes } from "./modules/recordings/routes.js";
import { bounds, busyMeter, isBusy, lagMeter, Overloaded, shedder } from "./overload.js";

declare module "fastify" {
  interface FastifyContextConfig {
    fileKeys?: string[]; // paths of fields holding S3 keys (files.ts): each is checked against the caller's family
    notFileKeys?: string[]; // fields named like keys that aren't, such as an idempotency key
    noBody?: boolean; // a write route that really takes no body
    ownCors?: boolean; // answers CORS itself, so cors.ts leaves it alone
  }
  interface FastifyInstance {
    fileKeyRoutes: { method: string; url: string; fields: string[] }[];
    notFileKeyRoutes: { method: string; url: string; fields: string[] }[]; // what said it isn't an S3 key: each needs its own check and test
    allRoutes: { method: string; url: string }[]; // every route, for routeCoverage.test.ts
  }
}

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Above the load balancer's idle_timeout (infra/modules/env/load_balancer.tf, 3700 s): if this side closed an idle connection first, the load balancer could
 * send a request down it as it closed, and the caller would get a 502. A test reads the Terraform and fails if this falls behind.
 */
export const KEEP_ALIVE_MS = 3_720_000;
/** How long a caller may take to send a whole request, not how long we may take to answer. Bodies are small: files go straight to S3. */
export const REQUEST_TIMEOUT_MS = 30_000;

/** Paths can hold capability tokens in their query, so logs get the path only. */
export const pathOnly = (url: string) => url.split("?")[0];

const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Whether a NUL byte is anywhere in a parsed request: Postgres text can't hold one. A loop, because a body can nest deeper than a call stack. */
function holdsNul(root: unknown): boolean {
  const left = [root];
  while (left.length > 0) {
    const value = left.pop();
    if (typeof value === "string") {
      if (value.includes("\0")) return true;
    } else if (value && typeof value === "object") {
      for (const [name, child] of Object.entries(value)) {
        if (name.includes("\0")) return true;
        left.push(child);
      }
    }
  }
  return false;
}

type FastifyFailure = Error & { statusCode?: number; code?: string; validation?: { instancePath?: string; params?: { missingProperty?: string } }[] };

/** The one field a schema refused, as a caller names it ("name", "edits.0.kind"), when there's one. */
function refusedField(validation: NonNullable<FastifyFailure["validation"]>): string | undefined {
  const first = validation[0];
  const path = [first?.instancePath?.replace(/^\//, "").replace(/\//g, "."), first?.params?.missingProperty].filter(Boolean).join(".");
  return path || undefined;
}

/** Any error as the answer the caller gets. Only an ApiError says why; the rest is a code with the api's own words. */
function asApiError(error: FastifyFailure, req: { log: FastifyInstance["log"]; id: unknown }): ApiError {
  if (error instanceof ApiError) return error;
  if (error.validation) return invalid(refusedField(error.validation));
  // Too busy, and nothing was written: the phone may simply try again. An alarm counts these lines (infra/modules/env/alerts.tf).
  if (isBusy(error)) {
    req.log.warn({ err: { type: error.name, code: error.code }, poolWait: isPoolWait(error), shed: error instanceof Overloaded ? error.reason : undefined }, "too busy to answer");
    return unavailable();
  }
  const status = error.statusCode ?? 500;
  if (status >= 500) {
    // Not the message: Postgres errors can carry row values, and family content never goes in logs.
    req.log.error({ err: { type: error.name, code: error.code } }, "request failed");
    Sentry.captureException(error, { tags: { request_id: String(req.id) } });
    return new ApiError(500, "server_error", {}, SORRY);
  }
  if (error.code === "FST_ERR_CTP_BODY_TOO_LARGE") return new ApiError(413, "too_large", {}, "That's too much to send at once.");
  // A body that isn't JSON (415 for its content type, 400 for its text) is bad input like any other, at Fastify's own status. `bad_type` is for a file's type.
  const notJson = error.code?.startsWith("FST_ERR_CTP") || error instanceof SyntaxError;
  return new ApiError(status, "invalid", {}, notJson ? "The body must be JSON." : undefined);
}

const SORRY = "Something went wrong on our side. Please try again.";

/** Fails at start, not in production, for a route that could take a file key without saying so. */
function guardFileKeys(app: FastifyInstance): void {
  app.decorate("fileKeyRoutes", []);
  app.decorate("notFileKeyRoutes", []);
  app.decorate("allRoutes", []);
  app.addHook("onRoute", (route) => {
    const methods = [route.method].flat();
    for (const method of methods) app.allRoutes.push({ method, url: route.url });
    const schema = route.schema as { body?: object; querystring?: object; params?: object } | undefined;
    if (methods.some((m) => WRITES.has(m)) && !schema?.body && !route.config?.noBody) {
      throw new Error(`${route.url}: a write route needs a body schema, or config.noBody`);
    }
    const found = [
      ...fieldPaths(schema?.body),
      ...fieldPaths(schema?.querystring).map((f) => `query.${f}`),
      ...fieldPaths(schema?.params).map((f) => `params.${f}`),
    ];
    const declared = route.config?.fileKeys ?? [];
    const exempt = route.config?.notFileKeys ?? [];
    const missing = found.filter((f) => looksLikeFileKey(lastName(f)) && !declared.includes(f) && !exempt.includes(f));
    if (missing.length > 0) {
      throw new Error(`${route.url}: declare ${missing.join(", ")} in config.fileKeys or config.notFileKeys`);
    }
    if (exempt.length > 0) {
      for (const method of methods) {
        if (method !== "HEAD") app.notFileKeyRoutes.push({ method, url: route.url, fields: exempt });
      }
    }
    if (declared.length > 0) {
      const existing = route.preValidation ? [route.preValidation].flat() : [];
      route.preValidation = [...existing, fileGuard(declared)];
      for (const method of methods) {
        if (method !== "HEAD") app.fileKeyRoutes.push({ method, url: route.url, fields: declared });
      }
    }
  });
}

/** `logStream`: production's logging, written somewhere a test can read. `logger` replaces it entirely. */
export function buildApp(options: { logger?: object | boolean; logStream?: NodeJS.WritableStream; routes?: (app: FastifyInstance) => void } = {}): FastifyInstance {
  const app = Fastify({
    // Only addresses inside our network count as proxies (the load balancer), so a caller can't set req.ip with a header.
    trustProxy: "10.0.0.0/8",
    bodyLimit: 1024 * 1024, // bytes never pass through the api: files go straight to S3
    keepAliveTimeout: KEEP_ALIVE_MS,
    requestTimeout: REQUEST_TIMEOUT_MS,
    logger: options.logger ?? {
      level: process.env.LOG_LEVEL ?? "info",
      ...(options.logStream ? { stream: options.logStream } : {}),
      serializers: {
        req: (req) => ({ method: req.method, path: pathOnly(req.url) }),
        res: (res) => ({ status: res.statusCode }),
      },
    },
    genReqId: (req) => {
      const given = req.headers["x-request-id"];
      return typeof given === "string" && REQUEST_ID.test(given) ? given : randomUUID();
    },
  } as FastifyServerOptions) as unknown as FastifyInstance;

  app.addHook("onSend", async (req, reply) => {
    reply.header("x-request-id", req.id);
  });
  appCors(app);

  // Stopping closes the connections idle at that moment. One that finishes a request a moment later would then stay open for
  // KEEP_ALIVE_MS and hold the stop up until ECS kills the task, so keep closing them until it's done.
  app.addHook("preClose", async () => {
    const sweep = setInterval(() => app.server.closeIdleConnections(), 100);
    sweep.unref();
    app.server.once("close", () => clearInterval(sweep));
  });

  guardFileKeys(app);

  // Overloaded: turned away before any work, with the busy 503 (overload.ts). Off unless OVERLOAD_SHED=on.
  const limit = bounds();
  if (limit) {
    const lag = lagMeter();
    const busy = busyMeter();
    app.addHook("onRequest", shedder(limit, busy.busy, lag.lagMs, () => db().waitingCount));
    app.addHook("onClose", async () => {
      lag.stop();
      busy.stop();
    });
  }

  // Before any route's own checks, so no route has to remember: Postgres would answer with an error, and that would be a 500.
  app.addHook("preValidation", async (req) => {
    if (holdsNul([req.params, req.query, req.body])) throw invalid();
  });

  app.setNotFoundHandler((req, reply) => sendError(reply, req, noRoute()));

  // Every route's errors end here, /dish and /invite included: their own handlers note what they need and pass the rest on.
  app.setErrorHandler((error: Error, req, reply) => sendError(reply, req, asApiError(error, req)));

  // For the load balancer: is this process up? Deliberately doesn't touch the database, or a database blip stops every task.
  app.get("/health", async () => "ok");

  // For people and deploys: can it reach what it needs? `database` stays beside the one shape, because people read it.
  app.get("/ready", async (req, reply) => {
    try {
      await db().query("select 1");
      return { database: "ok" };
    } catch {
      const down = unavailable();
      return reply.status(503).headers(down.headers).send({ database: "unreachable", ...errorBody(down, String(req.id)) });
    }
  });

  app.register(jobRoutes);
  app.register(recipeRoutes);
  app.register(recordingRoutes);
  app.register(peopleRoutes);
  app.register(accountRoutes);
  app.register(messageRoutes);
  app.register(dishRoutes, { prefix: "/dish" });
  app.register(liveRoutes);
  app.register(communityRoutes);
  app.register(cravingRoutes);
  app.register(inviteRoutes, { prefix: "/invite" });
  app.register(platformRoutes);
  options.routes?.(app);

  return app;
}
