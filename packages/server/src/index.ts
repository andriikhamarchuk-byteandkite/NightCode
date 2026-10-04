import { Hono } from "hono";
import { sentry } from "@sentry/hono/bun";
import * as Sentry from "@sentry/hono/bun";
import { HTTPException } from "hono/http-exception";
import dotenv from "dotenv";
import * as path from "node:path";
import sessions from "./routes/sessions";
import chat from "./routes/chat";
import auth from "./routes/auth";
import { requireAuth } from "./middleware/require-auth";

dotenv.config({
  path: path.resolve(import.meta.dirname, "../../../.env"),
});

for (const name of ["CLERK_SECRET_KEY", "CLERK_PUBLISHABLE_KEY"]) {
  if (!process.env[name]) {
    console.error(`${name} environment variable is required`);
    process.exit(1);
  }
}

const SENTRY_DSN = process.env.SENTRY_DSN;

const app = new Hono();

if (SENTRY_DSN) {
  app.use(
    sentry(app, {
      dsn: SENTRY_DSN,
      tracesSampleRate: 1.0,
    }),
  );
} else {
  console.warn("SENTRY_DSN is not set, Sentry monitoring is disabled");
}

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    Sentry.logger.warn("Handled HTTP error", {
      status: error.status,
      message: error.message || "Request failed",
      path: c.req.path,
      method: c.req.method,
    });

    return c.json(
      {
        error: error.message || "Request failed",
      },
      error.status,
    );
  }

  console.error("Unhandled server error", error);
  Sentry.logger.error("Unhandled server error", {
    path: c.req.path,
    message: error instanceof Error ? error.message : "Unknown error",
    method: c.req.method,
  });
  return c.json({ error: "Internal server error" }, 500);
});

app.use("/sessions/*", requireAuth);
app.use("/chat/*", requireAuth);

const routes = app
  .route("/sessions", sessions)
  .route("/chat", chat)
  .route("/auth", auth);

export type AppType = typeof routes;

export default {
  port: Number(process.env.PORT) || 3000,
  fetch: app.fetch,
  idleTimeout: 255,
};
