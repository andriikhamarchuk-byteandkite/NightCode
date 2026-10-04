import { Polar } from "@polar-sh/sdk";

type PolarServer = "sandbox" | "production";

function getRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is required`);
  }
  return value;
}

export function getPolarAccessToken() {
  return getRequiredEnv("POLAR_ACCESS_TOKEN");
}

export function getPolarProductId() {
  return getRequiredEnv("POLAR_PRODUCT_ID");
}

export function getPolarCreditsMeterId() {
  return getRequiredEnv("POLAR_CREDITS_METER_ID");
}

export function getPolarServer(): PolarServer {
  const server = process.env.POLAR_SERVER;
  if (!server) {
    return "sandbox";
  }

  if (server !== "sandbox" && server !== "production") {
    throw new Error("POLAR_SERVER must be either 'sandbox' or 'production'");
  }

  return server;
}

// Created on first use, not at import: ESM imports run before index.ts
// loads .env. index.ts checks the Polar env vars at startup.
let polar: Polar | undefined;

function getPolar() {
  polar ??= new Polar({
    accessToken: getPolarAccessToken(),
    server: getPolarServer(),
  });
  return polar;
}

// Redirect target for Polar pages. Taken from env, not from the request,
// because the Host header is client-controlled and wrong behind a proxy.
function getBillingReturnUrl() {
  const apiUrl = process.env.API_URL ?? "http://localhost:3000";
  return new URL("/billing/success", apiUrl).toString();
}

function hasStatusCode(error: unknown): error is { statusCode: number } {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
  );
}

type CreateCheckoutUrlParams = {
  customerExternalId: string;
};

export async function createCheckoutUrl({
  customerExternalId,
}: CreateCheckoutUrlParams) {
  const result = await getPolar().checkouts.create({
    products: [getPolarProductId()],
    successUrl: getBillingReturnUrl(),
    externalCustomerId: customerExternalId,
    metadata: { source: "nightcode-cli" },
  });

  return result.url;
}

export async function createCustomerPortalUrl({
  customerExternalId,
}: CreateCheckoutUrlParams) {
  const result = await getPolar().customerSessions.create({
    externalCustomerId: customerExternalId,
    returnUrl: getBillingReturnUrl(),
  });

  return result.customerPortalUrl;
}

export async function getAvailableCreditsBalance(customerExternalId: string) {
  try {
    const customerState = await getPolar().customers.getStateExternal({
      externalId: customerExternalId,
    });

    const creditsMeterId = getPolarCreditsMeterId();
    const creditsMeter = customerState.activeMeters.find(
      (meter) => meter.meterId === creditsMeterId,
    );

    return creditsMeter?.balance ?? 0;
  } catch (error) {
    if (hasStatusCode(error) && error.statusCode === 404) {
      return 0;
    }

    throw error;
  }
}

type IngestAiUsageParams = {
  externalCustomerId: string;
  eventId: string;
  credits: number;
};

export async function ingestAiUsage({
  externalCustomerId,
  eventId,
  credits,
}: IngestAiUsageParams) {
  if (credits <= 0) {
    return;
  }

  await getPolar().events.ingest({
    events: [
      {
        name: "nightcode_usage",
        externalId: eventId,
        externalCustomerId,
        metadata: { credits },
      },
    ],
  });
}
