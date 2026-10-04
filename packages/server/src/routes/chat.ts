import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { streamText as aiStreamText, stepCountIs } from "ai";
import { db } from "@nightcode/database/client";
import { Mode, MessageStatus } from "@nightcode/database/enums";
import {
  MAX_MESSAGE_LENGTH,
  messagePartsSchema,
  toolCallArgsSchema,
  type ChatStreamEvent,
  type MessagePart,
} from "@nightcode/shared";
import { isSupportedChatModel, resolveChatModel } from "../lib/models";
import type { Prisma } from "@nightcode/database";
import { createTools } from "../tools";
import { buildSystemPrompt } from "../system-prompt";
import type { AuthenticatedEnv } from "../middleware/require-auth";

const submitSchema = z.object({
  content: z.string().max(MAX_MESSAGE_LENGTH),
  mode: z.enum(Mode),
  model: z.string().refine(isSupportedChatModel, "Unsupported model"),
});

const submitValidator = zValidator("json", submitSchema, (result, c) => {
  if (!result.success) {
    return c.json({ error: "Invalid request body" }, 400);
  }
});

// Sessions with a stream in progress (submit or resume). Released only after
// the stream and its message persistence finish, so rows keep their order.
const activeStreamSessionIds = new Set<string>();

function buildConversationHistory(
  messages: {
    role: "USER" | "ASSISTANT" | "ERROR";
    content: string;
    status: MessageStatus;
  }[],
) {
  return messages.flatMap((m) => {
    if (m.role === "ERROR") return [];
    if (m.role === "ASSISTANT" && m.content.length === 0) return [];
    return [
      {
        role: m.role === "USER" ? ("user" as const) : ("assistant" as const),
        content: m.content,
      },
    ];
  });
}

function getResumableUserMessage(
  messages: {
    role: "USER" | "ASSISTANT" | "ERROR";
    model: string;
    mode: Mode;
  }[],
) {
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage || lastMessage.role !== "USER") {
    return null;
  }

  return lastMessage;
}

type StreamParams = {
  sessionId: string;
  model: string;
  cwd: string | null;
  history: { role: "user" | "assistant"; content: string }[];
  mode: Mode;
  abortController: AbortController;
};

function getErrorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function serializeParts(parts: MessagePart[]): {
  content: string;
  parts: Prisma.InputJsonValue | undefined;
} {
  const content = parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("");

  return {
    content,
    parts: parts.length > 0 ? messagePartsSchema.parse(parts) : undefined,
  };
}

async function streamAIResponse(
  stream: Parameters<Parameters<typeof streamSSE>[1]>[0],
  params: StreamParams,
) {
  const { sessionId, model, history, cwd, mode, abortController } = params;
  const startTime = Date.now();
  const resolvedModel = resolveChatModel(model);
  const parts: MessagePart[] = [];
  const tools = cwd ? createTools(cwd, mode) : undefined;

  // Persisted even when empty, so an interrupted turn never looks like a
  // pending user message that auto-resume would regenerate.
  const persistInterruptedMessage = async () => {
    const elapsedMs = Date.now() - startTime;

    await db.message.create({
      data: {
        sessionId,
        role: "ASSISTANT",
        status: MessageStatus.INTERRUPTED,
        model,
        ...serializeParts(parts),
        mode,
        duration: Math.round(elapsedMs / 1000),
      },
    });
  };

  try {
    const result = aiStreamText({
      model: resolvedModel.model,
      system: buildSystemPrompt({ cwd, mode }),
      messages: history,
      tools,
      stopWhen: tools ? stepCountIs(50) : undefined,
      abortSignal: abortController.signal,
      providerOptions: resolvedModel.providerOptions,
    });

    for await (const part of result.stream) {
      if (stream.aborted) break;

      if (part.type === "reasoning-delta") {
        const last = parts[parts.length - 1];
        if (last && last.type === "reasoning") {
          last.text += part.text;
        } else {
          parts.push({ type: "reasoning", text: part.text });
        }
        const event: ChatStreamEvent = {
          type: "reasoning-delta",
          text: part.text,
        };
        await stream.writeSSE({
          event: "reasoning-delta",
          data: JSON.stringify(event),
        });
      }

      if (part.type === "text-delta") {
        const last = parts[parts.length - 1];
        if (last && last.type === "text") {
          last.text += part.text;
        } else {
          parts.push({ type: "text", text: part.text });
        }

        const event: ChatStreamEvent = { type: "text-delta", text: part.text };
        await stream.writeSSE({
          event: "text-delta",
          data: JSON.stringify(event),
        });
      }

      if (part.type === "tool-call") {
        const parsedArgs = toolCallArgsSchema.safeParse(part.input);
        const args = parsedArgs.success ? parsedArgs.data : {};

        parts.push({
          type: "tool-call",
          id: part.toolCallId,
          name: part.toolName,
          args,
        });

        const event: ChatStreamEvent = {
          type: "tool-call",
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          args,
        };
        await stream.writeSSE({
          event: "tool-call",
          data: JSON.stringify(event),
        });
      }

      // tool-error comes when the input fails the tool schema or execute
      // throws; it is sent as a result so the client stops showing "calling".
      if (part.type === "tool-result" || part.type === "tool-error") {
        const output =
          part.type === "tool-result"
            ? part.output
            : { error: getErrorText(part.error) };
        const resultStr =
          typeof output === "string" ? output : JSON.stringify(output);

        const tcPart = parts.find(
          (p): p is Extract<MessagePart, { type: "tool-call" }> =>
            p.type === "tool-call" && p.id === part.toolCallId,
        );

        if (tcPart) {
          tcPart.result = resultStr;
        }

        const event: ChatStreamEvent = {
          type: "tool-result",
          toolCallId: part.toolCallId,
          result: resultStr,
        };

        await stream.writeSSE({
          event: "tool-result",
          data: JSON.stringify(event),
        });
      }

      if (part.type === "error") {
        throw part.error;
      }
    }

    if (stream.aborted || abortController.signal.aborted) {
      await persistInterruptedMessage();
      return;
    }

    const elapsedMs = Date.now() - startTime;

    const assistantMessage = await db.message.create({
      data: {
        sessionId,
        role: "ASSISTANT",
        status: MessageStatus.COMPLETE,
        model,
        ...serializeParts(parts),
        mode,
        duration: Math.round(elapsedMs / 1000),
      },
    });

    const doneEvent: ChatStreamEvent = {
      type: "done",
      messageId: assistantMessage.id,
      durationMs: elapsedMs,
    };

    await stream.writeSSE({ event: "done", data: JSON.stringify(doneEvent) });
  } catch (err) {
    if (abortController.signal.aborted) {
      await persistInterruptedMessage();
      return;
    }

    const message = getErrorText(err);

    if (parts.length > 0) {
      await persistInterruptedMessage();
    }

    await db.message.create({
      data: {
        sessionId,
        role: "ERROR",
        status: MessageStatus.COMPLETE,
        model,
        content: message,
        mode,
      },
    });

    const errorEvent: ChatStreamEvent = { type: "error", message };
    await stream.writeSSE({ event: "error", data: JSON.stringify(errorEvent) });
  }
}

const app = new Hono<AuthenticatedEnv>()
  .post("/:sessionId/resume", async (c) => {
    const sessionId = c.req.param("sessionId");
    const userId = c.get("userId");

    const session = await db.session.findUnique({
      where: { id: sessionId, userId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });

    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    const resumableMessage = getResumableUserMessage(session.messages);
    if (!resumableMessage) {
      return c.json(
        { error: "Session has no pending user message to resume" },
        409,
      );
    }

    if (!isSupportedChatModel(resumableMessage.model)) {
      return c.json(
        {
          error: `Session uses unsupported model: ${resumableMessage.model}`,
        },
        409,
      );
    }

    if (activeStreamSessionIds.has(sessionId)) {
      return c.json(
        {
          error: "Session already has an active response",
        },
        409,
      );
    }

    activeStreamSessionIds.add(sessionId);

    const history = buildConversationHistory(session.messages);
    const abortController = new AbortController();

    try {
      return streamSSE(
        c,
        async (stream) => {
          stream.onAbort(() => {
            abortController.abort();
          });

          try {
            await streamAIResponse(stream, {
              sessionId,
              model: resumableMessage.model,
              history,
              cwd: session.cwd,
              mode: resumableMessage.mode,
              abortController,
            });
          } finally {
            activeStreamSessionIds.delete(sessionId);
          }
        },
        async (err, stream) => {
          activeStreamSessionIds.delete(sessionId);
          const message = err instanceof Error ? err.message : String(err);
          const errorEvent: ChatStreamEvent = { type: "error", message };
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify(errorEvent),
          });
        },
      );
    } catch (error) {
      activeStreamSessionIds.delete(sessionId);
      throw error;
    }
  })
  .post("/:sessionId", submitValidator, async (c) => {
    const sessionId = c.req.param("sessionId");
    const userId = c.get("userId");

    const session = await db.session.findUnique({
      where: { id: sessionId, userId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });

    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    const data = c.req.valid("json");

    if (activeStreamSessionIds.has(sessionId)) {
      return c.json(
        {
          error: "Session already has an active response",
        },
        409,
      );
    }

    activeStreamSessionIds.add(sessionId);

    try {
      await db.message.create({
        data: {
          sessionId,
          role: "USER",
          status: MessageStatus.COMPLETE,
          model: data.model,
          content: data.content,
          mode: data.mode,
        },
      });

      const history = buildConversationHistory([
        ...session.messages,
        {
          role: "USER" as const,
          content: data.content,
          status: MessageStatus.COMPLETE,
        },
      ]);

      const abortController = new AbortController();

      return streamSSE(
        c,
        async (stream) => {
          stream.onAbort(() => {
            abortController.abort();
          });

          try {
            await streamAIResponse(stream, {
              sessionId,
              model: data.model,
              history,
              cwd: session.cwd,
              mode: data.mode,
              abortController,
            });
          } finally {
            activeStreamSessionIds.delete(sessionId);
          }
        },
        async (err, stream) => {
          activeStreamSessionIds.delete(sessionId);
          const message = err instanceof Error ? err.message : String(err);
          const errorEvent: ChatStreamEvent = { type: "error", message };
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify(errorEvent),
          });
        },
      );
    } catch (error) {
      activeStreamSessionIds.delete(sessionId);
      throw error;
    }
  });

export default app;
