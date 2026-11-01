// Loaded before everything else (Dockerfile's --import). No DSN means no Sentry: local runs and tests send nothing.
// Family content and tokens must not reach Sentry (docs/build/SYSTEM-DESIGN.md), so nothing about a request is collected, and scrub() is the second lock.
import * as Sentry from "@sentry/node";

export function scrub<T extends Sentry.Event>(event: T): T {
  if (event.request) {
    event.request = { method: event.request.method, url: event.request.url?.split("?")[0] };
  }
  // An error's text can hold row values (Postgres: "Key (x)=(...)"), so only its type and location go out.
  for (const exception of event.exception?.values ?? []) exception.value = "";
  delete event.message;
  delete event.logentry;
  delete event.user;
  return event;
}

if (process.env.SENTRY_DSN_API) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN_API,
    environment: process.env.DEPLOY_ENV ?? "local",
    release: process.env.RELEASE,
    // Sentry v11 collects all of this by default.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      genAI: { inputs: false, outputs: false },
    },
    tracesSampleRate: 0.1,
    maxBreadcrumbs: 0,
    beforeSend: scrub,
    beforeSendTransaction: scrub,
  });
}
