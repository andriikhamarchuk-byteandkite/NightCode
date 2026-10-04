import { createMiddleware } from "hono/factory";
import * as Sentry from "@sentry/hono/bun";
import { authenticateOAuthRequest } from "../lib/auth";

export type AuthenticatedEnv = {
  Variables: {
    userId: string;
  };
};

export const requireAuth = createMiddleware<AuthenticatedEnv>(async (c, next) => {
  let auth: Awaited<ReturnType<typeof authenticateOAuthRequest>>;
  try {
    auth = await authenticateOAuthRequest(c.req.raw);
  } catch (error) {
    // Clerk or network failure, not a bad token: 401 would make the CLI
    // delete a valid token.
    Sentry.captureException(error);
    return c.json({ error: "Authentication service unavailable" }, 503);
  }

  if (!auth) {
    return c.json({ error: "Unauthorized. Run /login to continue." }, 401);
  }

  c.set("userId", auth.userId);
  // Outside the try so route errors reach app.onError instead of becoming 401.
  await next();
});
