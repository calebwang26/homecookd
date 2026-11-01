// The api: a route checks the input and who's asking, a service holds the rules, data access holds the SQL.
// Every log line carries the request id, which a caller can pass in and which goes back on the response.
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import * as Sentry from "@sentry/node";
import { db } from "./db.js";

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

/** Paths can hold capability tokens in their query, so logs get the path only. */
export const pathOnly = (url: string) => url.split("?")[0];

export function buildApp(options: { logger?: object | boolean } = {}): FastifyInstance {
  const app = Fastify({
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
  });

  app.addHook("onSend", async (req, reply) => {
    reply.header("x-request-id", req.id);
  });

  app.setErrorHandler((error: Error & { statusCode?: number }, req, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) {
      req.log.error({ err: { type: error.name, message: error.message } }, "request failed");
      Sentry.captureException(error, { tags: { request_id: String(req.id) } });
      return reply.status(status).send({ error: "server_error", requestId: req.id });
    }
    return reply.status(status).send({ error: error.message, requestId: req.id });
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

  return app;
}
