import { buildApp } from "./app.js";

const app = buildApp();

// ECS sends SIGTERM before stopping a task: finish what's running, then leave.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => void app.close().then(() => process.exit(0)));
}

await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? 8080) });
