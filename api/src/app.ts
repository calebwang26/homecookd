// The api: a route checks the input and who's asking, a service holds the rules, data access holds the SQL.
// Every log line carries the request id, which a caller can pass in and which goes back on the response.
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import * as Sentry from "@sentry/node";
import { db } from "./db.js";
import { ApiError } from "./errors.js";
import { fileGuard, looksLikeFileKey } from "./files.js";
import { peopleRoutes } from "./modules/people/routes.js";

declare module "fastify" {
  interface FastifyContextConfig {
    fileKeys?: string[]; // body fields holding S3 keys: each is checked against the caller's family
    notFileKeys?: string[]; // body fields named like keys that aren't, such as an idempotency key
  }
  interface FastifyInstance {
    fileKeyRoutes: { method: string; url: string; fields: string[] }[];
  }
}

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

/** Paths can hold capability tokens in their query, so logs get the path only. */
export const pathOnly = (url: string) => url.split("?")[0];

/** Fails at start, not in production, for a route that takes a key and doesn't say what it is. */
function guardFileKeys(app: FastifyInstance): void {
  app.decorate("fileKeyRoutes", []);
  app.addHook("onRoute", (route) => {
    const properties = (route.schema?.body as { properties?: Record<string, unknown> } | undefined)?.properties ?? {};
    const declared = route.config?.fileKeys ?? [];
    const exempt = route.config?.notFileKeys ?? [];
    const missing = Object.keys(properties).filter((f) => looksLikeFileKey(f) && !declared.includes(f) && !exempt.includes(f));
    if (missing.length > 0) {
      throw new Error(`${route.url}: declare ${missing.join(", ")} in config.fileKeys or config.notFileKeys`);
    }
    if (declared.length > 0) {
      const existing = route.preValidation ? [route.preValidation].flat() : [];
      route.preValidation = [...existing, fileGuard(declared)];
      for (const method of [route.method].flat()) app.fileKeyRoutes.push({ method, url: route.url, fields: declared });
    }
  });
}

export function buildApp(options: { logger?: object | boolean; routes?: (app: FastifyInstance) => void } = {}): FastifyInstance {
  const app = Fastify({
    // Only addresses inside our network count as proxies (the load balancer), so a caller can't set req.ip with a header.
    trustProxy: "10.0.0.0/8",
    bodyLimit: 1024 * 1024, // bytes never pass through the api: files go straight to S3
    logger: options.logger ?? {
      level: process.env.LOG_LEVEL ?? "info",
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

  guardFileKeys(app);

  app.setNotFoundHandler((req, reply) => reply.status(404).send({ error: "not_found", requestId: req.id }));

  app.setErrorHandler((error: Error & { statusCode?: number; validation?: unknown }, req, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).headers(error.headers).send({ error: error.code, requestId: req.id });
    }
    if (error.validation) return reply.status(400).send({ error: "bad_request", requestId: req.id });
    const status = error.statusCode ?? 500;
    if (status >= 500) {
      // Not the message: Postgres errors can carry row values, and family content never goes in logs.
      req.log.error({ err: { type: error.name, code: (error as { code?: string }).code } }, "request failed");
      Sentry.captureException(error, { tags: { request_id: String(req.id) } });
      return reply.status(status).send({ error: "server_error", requestId: req.id });
    }
    return reply.status(status).send({ error: "bad_request", requestId: req.id });
  });

  // For the load balancer: is this process up? Deliberately doesn't touch the database, or a database blip stops every task.
  app.get("/health", async () => "ok");

  // For people and deploys: can it reach what it needs?
  app.get("/ready", async (_req, reply) => {
    try {
      await db().query("select 1");
      return { database: "ok" };
    } catch {
      return reply.status(503).send({ database: "unreachable" });
    }
  });

  app.register(peopleRoutes);
  options.routes?.(app);

  return app;
}
