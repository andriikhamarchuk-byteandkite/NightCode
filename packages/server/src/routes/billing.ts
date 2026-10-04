import { Hono } from "hono";
import * as Sentry from "@sentry/hono/bun";
import type { AuthenticatedEnv } from "../middleware/require-auth";
import { createCheckoutUrl, createCustomerPortalUrl } from "../lib/polar";

const app = new Hono<AuthenticatedEnv>()
  .post("/checkout", async (c) => {
    const userId = c.get("userId");
    const url = await createCheckoutUrl({
      customerExternalId: userId,
    });

    Sentry.logger.info("Created credits checkout");

    return c.json({ url });
  })
  .post("/portal", async (c) => {
    const userId = c.get("userId");
    const url = await createCustomerPortalUrl({
      customerExternalId: userId,
    });

    Sentry.logger.info("Created billing portal session");

    return c.json({ url });
  })
  .get("/success", (c) =>
    c.text("Done. You can close this tab and return to NightCode."),
  );

export default app;
