import { useState, useEffect, useMemo, useRef } from "react";
import { useParams, useLocation, useNavigate } from "react-router";
import { z } from "zod";
import type { InferResponseType } from "hono/client";
import { SessionShell } from "../components/session-shell";
import { ToolApproval } from "../components/tool-approval";
import { UserMessage, BotMessage, ErrorMessage } from "../components/messages";
import { useToast } from "../providers/toast";
import { apiClient } from "../lib/api-client";
import { getErrorMessage } from "../lib/http-errors";
import {
  Mode,
  modeSchema,
  type ModeType,
  type SupportedChatModelId,
} from "@nightcode/shared";
import { useChat, type Message } from "../hooks/use-chat";
import { useKeyboardLayer } from "../providers/keyboard-layer";
import { useKeyboard } from "@opentui/react";
import { usePromptConfig } from "../providers/prompt-config";

type SessionData = InferResponseType<
  (typeof apiClient.sessions)[":id"]["$get"],
  200
>;

const sessionLocationSchema = z.object({
  session: z.custom<SessionData>(
    (val) => val != null && typeof val === "object" && "id" in val,
  ),
  initialPrompt: z
    .object({
      message: z.string(),
      mode: modeSchema,
      model: z.custom<SupportedChatModelId>(),
    })
    .optional(),
});

function SessionChat({
  session,
  initialPrompt,
}: {
  session: SessionData;
  initialPrompt?: {
    message: string;
    mode: ModeType;
    model: SupportedChatModelId;
  };
}) {
  const [initialMessages] = useState(
    () =>
      Array.isArray(session.messages)
        ? (session.messages as unknown as Message[])
        : [],
  );
  const { isTopLayer } = useKeyboardLayer();
  const { mode, model } = usePromptConfig();
  const {
    messages,
    isBusy,
    pendingApproval,
    respondToApproval,
    submit,
    abort,
    interrupt,
  } = useChat(session.id, initialMessages);
  const hasSubmittedInitialPromptRef = useRef(false);

  useEffect(() => {
    return () => void abort();
  }, [abort]);

  useKeyboard((key) => {
    if (key.name === "escape" && isTopLayer("base") && isBusy) {
      key.preventDefault();
      void interrupt();
    }
  });

  useEffect(() => {
    if (!initialPrompt || hasSubmittedInitialPromptRef.current) return;
    hasSubmittedInitialPromptRef.current = true;
    void submit({
      userText: initialPrompt.message,
      mode: initialPrompt.mode,
      model: initialPrompt.model,
    });
  }, [initialPrompt, submit]);

  return (
    <SessionShell
      onSubmit={(text) => submit({ userText: text, mode, model })}
      inputDisabled={isBusy}
      loading={isBusy}
      interruptible={isBusy && !pendingApproval}
    >
      {messages.map((msg) => (
        <ChatMessage key={msg.id} msg={msg} />
      ))}
      {pendingApproval && (
        <ToolApproval
          key={pendingApproval.toolCallId}
          request={pendingApproval}
          onRespond={(approved) =>
            respondToApproval(pendingApproval.toolCallId, approved)
          }
        />
      )}
    </SessionShell>
  );
}

function ChatMessage({ msg }: { msg: Message }) {
  if (msg.role === "user") {
    const text = msg.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("");
    return <UserMessage message={text} mode={msg.metadata?.mode ?? Mode.BUILD} />;
  }

  const error = msg.metadata?.error;
  const hasContent = msg.parts.some((p) => p.type !== "step-start");

  return (
    <>
      {(hasContent || !error) && (
        <BotMessage
          parts={msg.parts}
          model={msg.metadata?.model ?? "unknown"}
          mode={msg.metadata?.mode ?? Mode.BUILD}
          durationMs={msg.metadata?.durationMs}
          interrupted={msg.metadata?.interrupted}
          streaming={false}
        />
      )}
      {error && <ErrorMessage message={error} />}
    </>
  );
}

export function Session() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();

  const prefetched = useMemo(() => {
    const parsed = sessionLocationSchema.safeParse(location.state);
    return parsed.success ? parsed.data : null;
  }, [location.state]);

  const [session, setSession] = useState<SessionData | null>(
    prefetched?.session ?? null,
  );

  useEffect(() => {
    if (prefetched?.session) {
      return;
    }

    setSession(null);

    if (!id) return;

    let ignore = false;
    const fetchSession = async () => {
      try {
        const res = await apiClient.sessions[":id"].$get({
          param: { id },
        });
        if (ignore) return;
        if (!res.ok) throw new Error(await getErrorMessage(res));
        const resolved = await res.json();
        setSession(resolved);
      } catch (err) {
        if (ignore) return;
        toast.show({
          variant: "error",
          message:
            err instanceof Error ? err.message : "Failed to load session",
        });
        navigate("/", { replace: true });
      }
    };

    fetchSession();
    return () => {
      ignore = true;
    };
  }, [id, prefetched, toast, navigate]);

  if (!session) {
    return <SessionShell onSubmit={() => {}} inputDisabled loading />;
  }

  return (
    <SessionChat
      key={session.id}
      session={session}
      initialPrompt={prefetched?.initialPrompt}
    ></SessionChat>
  );
}
