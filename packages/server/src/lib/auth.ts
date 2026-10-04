import { createClerkClient } from "@clerk/backend";

// Created on first use, not at import: ESM imports run before index.ts
// loads .env, so reading the keys here would depend on import order.
// index.ts checks that both keys are set at startup.
let clerkClient: ReturnType<typeof createClerkClient> | undefined;

function getClerkClient() {
  clerkClient ??= createClerkClient({
    secretKey: process.env.CLERK_SECRET_KEY,
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
  });
  return clerkClient;
}

export async function authenticateOAuthRequest(request: Request) {
  const requestState = await getClerkClient().authenticateRequest(request, {
    acceptsToken: "oauth_token",
  });

  if (!requestState.isAuthenticated) {
    return null;
  }

  const auth = requestState.toAuth();
  if (auth.tokenType !== "oauth_token" || !auth.userId) {
    return null;
  }

  return { userId: auth.userId };
}
