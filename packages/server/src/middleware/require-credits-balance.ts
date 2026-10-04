import { createMiddleware } from "hono/factory";
import * as Sentry from "@sentry/hono/bun";
import type { AuthenticatedEnv } from "./require-auth";
import { getAvailableCreditsBalance } from "../lib/polar";

export const requireCreditsBalance = createMiddleware<AuthenticatedEnv>(
  async (c, next) => {
    let creditsBalance: number;
    try {
      creditsBalance = await getAvailableCreditsBalance(c.get("userId"));
    } catch (error) {
      Sentry.captureException(error);
      return c.json(
        { error: "Unable to verify credits balance right now." },
        503,
      );
    }

    if (creditsBalance <= 0) {
      Sentry.logger.warn("Request blocked: no credits remaining", {
        path: c.req.path,
        creditsBalance,
      });
      return c.json(
        { error: "No credits remaining. Run /upgrade to buy more credits." },
        402,
      );
    }

    // Outside the try so route errors reach app.onError instead of becoming 503.
    await next();
  },
);
