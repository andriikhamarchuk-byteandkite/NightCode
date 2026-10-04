import {
  SUPPORTED_CHAT_MODELS,
  findSupportedChatModel,
  type ModelPricing,
} from "@nightcode/shared";
import type { LanguageModelUsage } from "ai";
import * as Sentry from "@sentry/hono/bun";

type CalculateCreditsForUsageParams = {
  provider: string;
  model: string;
  stepUsages: LanguageModelUsage[];
};

type BillableUsage = {
  credits: number;
};

type TokenCounts = {
  inputTokens: number;
  outputTokens: number;
};

const TOKENS_PER_MILLION = 1_000_000;

const USD_PER_CREDIT = 0.01;

function getStepTokenCounts(usage: LanguageModelUsage): TokenCounts {
  const inputTokens = usage.inputTokens;
  const outputTokens = usage.outputTokens;

  if (
    inputTokens == null ||
    outputTokens == null ||
    !Number.isFinite(inputTokens) ||
    !Number.isFinite(outputTokens) ||
    !Number.isInteger(inputTokens) ||
    !Number.isInteger(outputTokens) ||
    inputTokens < 0 ||
    outputTokens < 0
  ) {
    // Some providers send no usage for a failed or cut-off step. Count it as 0
    // so the other steps of the turn are still billed.
    Sentry.logger.warn("Step usage has no valid token counts", {
      inputTokens: String(inputTokens),
      outputTokens: String(outputTokens),
    });
    return { inputTokens: 0, outputTokens: 0 };
  }

  return {
    inputTokens,
    outputTokens,
  };
}

// A tool-calling turn runs several model steps; each step reports its own
// usage, so the turn is billed for their sum.
function getTokenCounts(stepUsages: LanguageModelUsage[]): TokenCounts {
  return stepUsages.map(getStepTokenCounts).reduce(
    (total, step) => ({
      inputTokens: total.inputTokens + step.inputTokens,
      outputTokens: total.outputTokens + step.outputTokens,
    }),
    { inputTokens: 0, outputTokens: 0 },
  );
}

function getModelPricing(provider: string, model: string): ModelPricing {
  const supportedModel = findSupportedChatModel(model);

  if (!supportedModel || supportedModel.provider !== provider) {
    if (
      !SUPPORTED_CHAT_MODELS.some(
        (supportedModel) => supportedModel.provider === provider,
      )
    ) {
      throw new Error(`Unsupported billing provider: ${provider}`);
    }

    throw new Error(`Unsupported billing model: ${model}`);
  }

  return supportedModel.pricing;
}

function estimateCostUsd(
  { inputTokens, outputTokens }: TokenCounts,
  pricing: ModelPricing,
) {
  return (
    (inputTokens * pricing.inputUsdPerMillionTokens +
      outputTokens * pricing.outputUsdPerMillionTokens) /
    TOKENS_PER_MILLION
  );
}

function convertUsdToCredits(estimatedCostUsd: number) {
  if (estimatedCostUsd <= 0) {
    return 0;
  }

  // Float division can land just above a whole number (0.07 / 0.01 is
  // 7.000000000000001), so trim that noise before rounding up. A non-zero
  // cost still bills at least 1 credit even if it rounds to 0 here.
  const credits = Number((estimatedCostUsd / USD_PER_CREDIT).toFixed(6));

  return Math.max(1, Math.ceil(credits));
}

export function calculateCreditsForUsage({
  provider,
  model,
  stepUsages,
}: CalculateCreditsForUsageParams): BillableUsage {
  const tokenCounts = getTokenCounts(stepUsages);
  const pricing = getModelPricing(provider, model);
  const estimatedCostUsd = estimateCostUsd(tokenCounts, pricing);
  const credits = convertUsdToCredits(estimatedCostUsd);

  return {
    credits,
  };
}
