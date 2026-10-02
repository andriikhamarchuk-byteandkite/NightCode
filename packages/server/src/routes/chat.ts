import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import * as Sentry from "@sentry/hono/bun";
import {
  convertToModelMessages,
  streamText,
  validateUIMessages,
  type InferUITools,
  type LanguageModelUsage,
  type UIMessage,
} from "ai";
import { db } from "@nightcode/database/client";
import type { Prisma } from "@nightcode/database";
import {
  buildToolContracts,
  getToolContracts,
  modeSchema,
  type ModeType,
  type ToolContracts,
} from "@nightcode/shared";
import { buildSystemPrompt } from "../system-prompt";
import type { AuthenticatedEnv } from "../middleware/require-auth";
import { requireCreditsBalance } from "../middleware/require-credits-balance";
import { calculateCreditsForUsage } from "../lib/credits";
import { ingestAiUsage } from "../lib/polar";
import { isSupportedChatModel, resolveChatModel } from "../lib/models";

const MAX_MESSAGE_LENGTH = 20_000;

// Each request runs a single model step; the client sends the next one after
// it runs the requested tools. Once a turn reaches this many steps the model
// may no longer call tools, so it has to answer in text and the loop ends.
const MAX_STEPS_PER_TURN = 50;

const INTERRUPTED_TOOL_ERROR =
  "Interrupted by the user before the tool returned a result";

type ChatMessageMetadata = {
  mode?: ModeType;
  model?: string;
  durationMs?: number;
  usage?: LanguageModelUsage;
  interrupted?: boolean;
  error?: string;
};

type NightcodeUIMessage = UIMessage<
  ChatMessageMetadata,
  never,
  InferUITools<ToolContracts>
>;

type MessagePart = NightcodeUIMessage["parts"][number];
type ToolPart = Extract<MessagePart, { toolCallId: string }>;

const submitSchema = z.object({
  id: z.string(),
  messages: z
    .array(
      z.custom<NightcodeUIMessage>((value) => {
        return (
          value != null &&
          typeof value === "object" &&
          "id" in value &&
          typeof value.id === "string" &&
          "role" in value &&
          (value.role === "user" || value.role === "assistant") &&
          "parts" in value &&
          Array.isArray(value.parts)
        );
      }),
    )
    .min(1),
  mode: modeSchema,
  model: z.string().refine(isSupportedChatModel, "Unsupported model"),
  // process.platform of the client, e.g. "win32"; goes into the system prompt.
  platform: z
    .string()
    .regex(/^[a-z0-9]{1,20}$/)
    .optional(),
});

const submitValidator = zValidator("json", submitSchema, (result, c) => {
  if (!result.success) {
    return c.json({ error: "Invalid request body" }, 400);
  }
});

// Sessions with a request in progress. Released once the response messages
// are persisted, so two requests never overwrite each other's messages.
const activeStreamSessionIds = new Set<string>();

function isToolPart(part: MessagePart): part is ToolPart {
  return "toolCallId" in part;
}

function getTextLength(message: NightcodeUIMessage) {
  return message.parts.reduce(
    (length, part) =>
      part.type === "text" ? length + part.text.length : length,
    0,
  );
}

// Copies the results of the tools the client ran into the stored assistant
// message. Only tool calls still waiting for a result are filled in.
function applyToolOutputs(
  stored: NightcodeUIMessage,
  incoming: NightcodeUIMessage,
): NightcodeUIMessage {
  const incomingToolParts = new Map(
    incoming.parts.filter(isToolPart).map((part) => [part.toolCallId, part]),
  );

  return {
    ...stored,
    parts: stored.parts.map((part) => {
      if (!isToolPart(part) || part.state !== "input-available") return part;

      const result = incomingToolParts.get(part.toolCallId);

      if (result?.state === "output-available") {
        return { ...part, state: "output-available", output: result.output };
      }

      if (result?.state === "output-error") {
        return { ...part, state: "output-error", errorText: result.errorText };
      }

      return part;
    }) as MessagePart[],
  };
}

// The client sends only the new user message, or the last assistant message
// with the results of the tools it ran. Everything else comes from the
// database, so the client cannot rewrite earlier turns.
function mergeClientMessages(
  stored: NightcodeUIMessage[],
  incoming: NightcodeUIMessage[],
  metadata: ChatMessageMetadata,
) {
  const merged = [...stored];

  for (const message of incoming) {
    const storedIndex = merged.findIndex((m) => m.id === message.id);

    if (message.role === "user") {
      if (storedIndex !== -1) continue;

      merged.push({
        id: message.id,
        role: "user",
        parts: message.parts.filter((part) => part.type === "text"),
        metadata,
      });
      continue;
    }

    const isLastStoredAssistant =
      storedIndex !== -1 &&
      storedIndex === merged.length - 1 &&
      merged[storedIndex]?.role === "assistant";

    if (isLastStoredAssistant) {
      merged[storedIndex] = applyToolOutputs(merged[storedIndex]!, message);
    }
  }

  return merged;
}

// A tool call left without a result (the turn was interrupted, or the client
// never sent it) would make the provider reject the whole history, so it is
// closed as an error the model can see.
function closePendingToolCalls(messages: NightcodeUIMessage[]) {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.flatMap((part): MessagePart[] => {
      if (!isToolPart(part)) return [part];
      if (part.state === "input-streaming") return [];
      if (part.state === "input-available") {
        return [
          {
            ...part,
            state: "output-error",
            errorText: INTERRUPTED_TOOL_ERROR,
          } as MessagePart,
        ];
      }
      return [part];
    }),
  }));
}

function countTurnSteps(messages: NightcodeUIMessage[]) {
  const lastMessage = messages[messages.length - 1];
  if (lastMessage?.role !== "assistant") return 0;

  return lastMessage.parts.filter((part) => part.type === "step-start").length;
}

function hasContent(message: NightcodeUIMessage) {
  return message.parts.some((part) => part.type !== "step-start");
}

const app = new Hono<AuthenticatedEnv>().post(
  "/",
  requireCreditsBalance,
  submitValidator,
  async (c) => {
    const userId = c.get("userId");
    const { id, messages, mode, model, platform } = c.req.valid("json");

    const session = await db.session.findUnique({
      where: { id, userId },
    });

    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    if (
      messages.some(
        (m) => m.role === "user" && getTextLength(m) > MAX_MESSAGE_LENGTH,
      )
    ) {
      return c.json({ error: "Message is too long" }, 400);
    }

    if (activeStreamSessionIds.has(id)) {
      return c.json({ error: "Session already has an active response" }, 409);
    }

    const storedMessages = Array.isArray(session.messages)
      ? (session.messages as unknown as NightcodeUIMessage[])
      : [];
    const mergedMessages = closePendingToolCalls(
      mergeClientMessages(storedMessages, messages, { mode, model }),
    );

    let nextMessages: NightcodeUIMessage[];
    try {
      // Validated against every tool, not only the ones of the current mode:
      // a BUILD turn in the history keeps its writeFile and bash calls in PLAN.
      nextMessages = await validateUIMessages<NightcodeUIMessage>({
        messages: mergedMessages,
        tools: buildToolContracts,
      });
    } catch (error) {
      Sentry.captureException(error, { extra: { sessionId: id } });
      return c.json({ error: "Invalid messages" }, 400);
    }

    activeStreamSessionIds.add(id);

    try {
      const startTime = Date.now();
      const requestId = crypto.randomUUID();
      const resolvedModel = resolveChatModel(model);
      // Replies that failed before producing anything are kept only to show
      // the error in the session; the model gets no empty assistant turns.
      const modelMessages = await convertToModelMessages(
        nextMessages.filter((m) => m.role !== "assistant" || hasContent(m)),
        { tools: buildToolContracts },
      );

      // Nothing new to answer: the client sent tool results the server could
      // not match, so the history ends with the model's own reply. Providers
      // reject that as assistant prefill.
      if (modelMessages[modelMessages.length - 1]?.role === "assistant") {
        activeStreamSessionIds.delete(id);
        return c.json({ error: "Nothing to respond to" }, 400);
      }

      const activeTools = Object.keys(
        getToolContracts(mode),
      ) as (keyof ToolContracts)[];
      const stepLimitReached =
        countTurnSteps(nextMessages) >= MAX_STEPS_PER_TURN;

      // Collected per step instead of from onFinish, which does not fire when
      // the request is aborted; steps that finished before the abort are
      // still billed.
      const stepUsages: LanguageModelUsage[] = [];
      let streamError: string | undefined;

      const result = streamText({
        model: resolvedModel.model,
        system: buildSystemPrompt({ mode, platform }),
        messages: modelMessages,
        tools: buildToolContracts,
        activeTools,
        toolChoice: stepLimitReached ? "none" : undefined,
        abortSignal: c.req.raw.signal,
        providerOptions: resolvedModel.providerOptions,
        onStepEnd(step) {
          stepUsages.push(step.usage);
        },
      });

      return result.toUIMessageStreamResponse<NightcodeUIMessage>({
        originalMessages: nextMessages,
        // Sent to the client in the start chunk, so both sides use the same
        // id and the next request's tool results match the stored message.
        // A continued turn keeps the id of the last assistant message.
        generateMessageId: () => crypto.randomUUID(),
        messageMetadata({ part }) {
          if (part.type === "start") {
            return { mode, model };
          }

          if (part.type !== "finish") return undefined;

          return {
            mode,
            model,
            durationMs: Date.now() - startTime,
            usage: part.totalUsage,
          };
        },
        async onEnd({ messages: finalMessages, responseMessage, isAborted }) {
          try {
            const endedEarly = isAborted || streamError !== undefined;
            const messagesToSave = finalMessages
              .map((message) =>
                endedEarly && message.id === responseMessage.id
                  ? {
                      ...message,
                      metadata: {
                        ...message.metadata,
                        mode,
                        model,
                        durationMs: Date.now() - startTime,
                        ...(isAborted ? { interrupted: true } : {}),
                        ...(streamError ? { error: streamError } : {}),
                      },
                    }
                  : message,
              )
              .filter(
                (message) =>
                  message.role !== "assistant" ||
                  hasContent(message) ||
                  message.metadata?.error !== undefined,
              );

            await db.session.update({
              where: { id, userId },
              data: {
                messages: messagesToSave as unknown as Prisma.InputJsonValue,
              },
            });
          } catch (error) {
            console.error("Failed to persist chat messages", error);
            Sentry.captureException(error, {
              extra: { sessionId: id, messageId: responseMessage.id },
            });
          } finally {
            activeStreamSessionIds.delete(id);
          }

          if (stepUsages.length === 0) return;

          try {
            const billableUsage = calculateCreditsForUsage({
              provider: resolvedModel.provider,
              model: resolvedModel.modelId,
              usage: stepUsages,
            });

            // One turn spans several requests that continue the same message,
            // so the event is keyed by request to keep Polar from dropping
            // the later ones as duplicates.
            await ingestAiUsage({
              externalCustomerId: userId,
              eventId: `chat-request:${requestId}`,
              credits: billableUsage.credits,
            });

            Sentry.logger.info("Ingested AI usage", {
              sessionId: id,
              messageId: responseMessage.id,
              requestId,
              interrupted: isAborted,
              credits: billableUsage.credits,
            });
          } catch (error) {
            console.error(
              "Failed to ingest Polar AI usage for chat message",
              error,
            );
            Sentry.captureException(error, {
              extra: {
                sessionId: id,
                messageId: responseMessage.id,
                requestId,
              },
            });
          }
        },
        onError(error) {
          Sentry.captureException(error, { extra: { sessionId: id } });
          streamError = error instanceof Error ? error.message : String(error);
          return streamError;
        },
      });
    } catch (error) {
      activeStreamSessionIds.delete(id);
      throw error;
    }
  },
);

export default app;
