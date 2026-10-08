import { useCallback, useMemo, useRef, useState } from "react";
import { useChat as useAiChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  type InferUITools,
  lastAssistantMessageIsCompleteWithToolCalls,
  type LanguageModelUsage,
  type UIMessage,
} from "ai";
import {
  Mode,
  type ModeType,
  type SupportedChatModelId,
  type ToolContracts,
} from "@nightcode/shared";
import { apiClient } from "../lib/api-client";
import { getAuth } from "../lib/auth";
import { executeLocalTool } from "../lib/local-tools";

export type ChatMessageMetadata = {
  mode?: ModeType;
  model?: SupportedChatModelId | string;
  durationMs?: number;
  usage?: LanguageModelUsage;
  interrupted?: boolean;
  error?: string;
};

type ChatTools = {
  [Name in keyof InferUITools<ToolContracts>]: {
    input: InferUITools<ToolContracts>[Name]["input"];
    output: unknown;
  };
};

export type Message = UIMessage<ChatMessageMetadata, never, ChatTools>;

type MessagePart = Message["parts"][number];

export type ToolApprovalRequest = {
  toolCallId: string;
  toolName: string;
  input: unknown;
};

// Tools that change files or run commands; the user approves each call
// before it runs. Read-only tools run without asking.
const TOOLS_REQUIRING_APPROVAL = new Set(["writeFile", "editFile", "bash"]);

const TOOL_REJECTED_ERROR = "The user rejected this tool call";
const TOOL_INTERRUPTED_ERROR =
  "Interrupted by the user before the tool returned a result";

function closePendingToolParts(parts: MessagePart[]): MessagePart[] {
  return parts.map((part) => {
    if (!("toolCallId" in part)) return part;
    if (part.state !== "input-streaming" && part.state !== "input-available") {
      return part;
    }

    return {
      ...part,
      state: "output-error",
      errorText: TOOL_INTERRUPTED_ERROR,
    } as MessagePart;
  });
}

export function useChat(sessionId: string, initialMessages: Message[]) {
  const transport = useMemo(() => {
    return new DefaultChatTransport<Message>({
      api: apiClient.chat.$url().toString(),
      headers() {
        const auth = getAuth();
        return auth ? { Authorization: `Bearer ${auth.token}` } : new Headers();
      },
      prepareSendMessagesRequest({ messages }) {
        const message = messages[messages.length - 1];
        if (!message) throw new Error("No message to send");

        const metadata = messages.findLast(
          (m) => m.metadata?.mode && m.metadata?.model,
        )?.metadata;
        const previousMessage = messages[messages.length - 2];
        const requestMessages =
          message.role === "assistant" && previousMessage?.role === "user"
            ? [previousMessage, message]
            : [message];

        return {
          body: {
            id: sessionId,
            messages: requestMessages,
            mode: message.metadata?.mode ?? metadata?.mode,
            model: message.metadata?.model ?? metadata?.model,
            // Tools run on this machine, so the model has to know its OS.
            platform: process.platform,
          },
        };
      },
    });
  }, [sessionId]);

  // The chat keeps the callbacks from its first render, so values they read
  // must live in refs; chat.messages there would stay the initial messages.
  const modeRef = useRef<ModeType>(
    initialMessages.findLast((m) => m.metadata?.mode)?.metadata?.mode ??
      Mode.PLAN,
  );
  // Aborted on stop, so running tools are killed and their late results
  // do not send the next request and restart the turn.
  const turnControllerRef = useRef(new AbortController());
  const approvalResolversRef = useRef(
    new Map<string, (approved: boolean) => void>(),
  );
  const [approvalQueue, setApprovalQueue] = useState<ToolApprovalRequest[]>([]);
  const [runningToolCount, setRunningToolCount] = useState(0);

  const requestApproval = (
    request: ToolApprovalRequest,
    signal: AbortSignal,
  ) => {
    // An abort event already fired would never reach the listener below,
    // leaving the promise pending and the chat busy forever.
    if (signal.aborted) return Promise.resolve(false);

    return new Promise<boolean>((resolve) => {
      const onAbort = () => settle(false);
      const settle = (approved: boolean) => {
        signal.removeEventListener("abort", onAbort);
        approvalResolversRef.current.delete(request.toolCallId);
        setApprovalQueue((queue) =>
          queue.filter((r) => r.toolCallId !== request.toolCallId),
        );
        resolve(approved);
      };

      approvalResolversRef.current.set(request.toolCallId, settle);
      signal.addEventListener("abort", onAbort, { once: true });
      setApprovalQueue((queue) => [...queue, request]);
    });
  };

  const runToolCall = async (toolCall: ToolApprovalRequest) => {
    const signal = turnControllerRef.current.signal;
    const mode = modeRef.current;
    const tool = toolCall.toolName as keyof ChatTools;

    // PLAN mode rejects these tools in executeLocalTool, so there is
    // nothing to approve there.
    if (
      mode === Mode.BUILD &&
      TOOLS_REQUIRING_APPROVAL.has(toolCall.toolName)
    ) {
      const approved = await requestApproval(toolCall, signal);
      if (signal.aborted) return;

      if (!approved) {
        return chatRef.current.addToolOutput({
          tool,
          toolCallId: toolCall.toolCallId,
          state: "output-error",
          errorText: TOOL_REJECTED_ERROR,
        });
      }
    }

    try {
      const output = await executeLocalTool(
        toolCall.toolName,
        toolCall.input,
        mode,
        signal,
      );
      if (signal.aborted) return;

      return chatRef.current.addToolOutput({
        tool,
        toolCallId: toolCall.toolCallId,
        output,
      });
    } catch (error) {
      if (signal.aborted) return;

      return chatRef.current.addToolOutput({
        tool,
        toolCallId: toolCall.toolCallId,
        state: "output-error",
        errorText: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const chat = useAiChat<Message>({
    id: sessionId,
    messages: initialMessages,
    transport,
    onToolCall({ toolCall }) {
      setRunningToolCount((count) => count + 1);

      void runToolCall({
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        input: toolCall.input,
      }).finally(() => setRunningToolCount((count) => count - 1));
    },
    onError(error) {
      const errorText = error.message;

      // Deferred so the chat finishes its own error handling first and
      // does not overwrite the marked message.
      setTimeout(() => {
        chatRef.current.setMessages((messages) => {
          const lastMessage = messages[messages.length - 1];

          if (lastMessage?.role === "assistant") {
            return [
              ...messages.slice(0, -1),
              {
                ...lastMessage,
                parts: closePendingToolParts(lastMessage.parts),
                metadata: { ...lastMessage.metadata, error: errorText },
              },
            ];
          }

          return [
            ...messages,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              parts: [],
              metadata: { mode: modeRef.current, error: errorText },
            },
          ];
        });
      });
    },
    sendAutomaticallyWhen: (options) =>
      !turnControllerRef.current.signal.aborted &&
      lastAssistantMessageIsCompleteWithToolCalls(options),
  });

  const chatRef = useRef(chat);
  chatRef.current = chat;

  const isBusy =
    chat.status === "streaming" ||
    chat.status === "submitted" ||
    runningToolCount > 0;
  const isBusyRef = useRef(isBusy);
  isBusyRef.current = isBusy;

  // Stable, so effects that depend on it do not stop the turn on re-render.
  const stop = useCallback(async () => {
    const wasBusy = isBusyRef.current;

    turnControllerRef.current.abort();
    await chatRef.current.stop();

    if (!wasBusy) return;

    chatRef.current.setMessages((messages) => {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage?.role !== "assistant") return messages;

      return [
        ...messages.slice(0, -1),
        {
          ...lastMessage,
          parts: closePendingToolParts(lastMessage.parts),
          metadata: { ...lastMessage.metadata, interrupted: true },
        },
      ];
    });
  }, []);

  const respondToApproval = useCallback(
    (toolCallId: string, approved: boolean) => {
      approvalResolversRef.current.get(toolCallId)?.(approved);
    },
    [],
  );

  return {
    messages: chat.messages,
    status: chat.status,
    isBusy,
    pendingApproval: approvalQueue[0] ?? null,
    respondToApproval,
    submit: (params: {
      userText: string;
      mode: ModeType;
      model: SupportedChatModelId;
    }) => {
      modeRef.current = params.mode;
      turnControllerRef.current = new AbortController();

      return chat.sendMessage({
        text: params.userText,
        metadata: {
          mode: params.mode,
          model: params.model,
        },
      });
    },
    abort: stop,
    interrupt: stop,
  };
}
