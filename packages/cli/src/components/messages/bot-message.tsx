import type { Message } from "../../hooks/use-chat";
import { useTheme } from "../../providers/theme";
import { TextAttributes } from "@opentui/core";
import { Mode, type ModeType } from "@nightcode/shared";
import prettyMs from "pretty-ms";

const SUMMARY_ARG_NAMES = ["command", "pattern", "path"];
const MAX_ARGS_LENGTH = 80;

type ClientMessagePart = Message["parts"][number];
type ToolPart = Extract<
  ClientMessagePart,
  { type: `tool-${string}` | "dynamic-tool" }
>;

type Props = {
  parts: ClientMessagePart[];
  model: string;
  mode: ModeType;
  durationMs?: number;
  streaming?: boolean;
  interrupted?: boolean;
};

type PartGroup = {
  type: ClientMessagePart["type"];
  parts: ClientMessagePart[];
  key: string;
};

function formatToolName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

function isToolPart(part: ClientMessagePart): part is ToolPart {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

// Show only the arg that tells what the tool is doing (not e.g. the full
// file content of writeFile), on one short line.
function formatToolArgs(tc: ToolPart): string {
  if (!("input" in tc) || tc.input == null || typeof tc.input !== "object") {
    return "";
  }

  const input = tc.input as Record<string, unknown>;
  const name = SUMMARY_ARG_NAMES.find((n) => typeof input[n] === "string");
  const value = name ? String(input[name]) : "";
  const oneLine = value.replace(/\s+/g, " ").trim();

  return oneLine.length > MAX_ARGS_LENGTH
    ? `${oneLine.slice(0, MAX_ARGS_LENGTH)}…`
    : oneLine;
}

// bash reports a failed command as a normal result with a non-zero exit
// code, so its error is in the output, not in errorText.
function formatToolResult(tc: ToolPart): string {
  if (tc.state === "output-error") return ` ${tc.errorText}`;
  if (tc.state !== "output-available") return " …";

  const output = tc.output;
  if (
    output == null ||
    typeof output !== "object" ||
    !("exitCode" in output) ||
    output.exitCode === 0
  ) {
    return "";
  }

  const stderr =
    "stderr" in output && typeof output.stderr === "string"
      ? (output.stderr.trim().split("\n")[0] ?? "")
      : "";
  const firstLine =
    stderr.length > MAX_ARGS_LENGTH
      ? `${stderr.slice(0, MAX_ARGS_LENGTH)}…`
      : stderr;

  return ` exit ${String(output.exitCode)}${firstLine ? `: ${firstLine}` : ""}`;
}

function groupConsecutiveParts(parts: ClientMessagePart[]): PartGroup[] {
  const groups: PartGroup[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const lastGroup = groups[groups.length - 1];

    if (lastGroup && lastGroup.type === part.type) {
      lastGroup.parts.push(part);
    } else {
      const key = isToolPart(part)
        ? `group-tc-${part.toolCallId}`
        : `group-${part.type}-${i}`;
      groups.push({ type: part.type, parts: [part], key });
    }
  }

  return groups;
}

export function BotMessage({
  parts,
  model,
  mode,
  durationMs,
  streaming = false,
  interrupted = false,
}: Props) {
  const { colors } = useTheme();

  return (
    <box width="100%" alignItems="center">
      {groupConsecutiveParts(parts).map((group, i) => (
        <box key={group.key} width="100%" paddingTop={i === 0 ? 0 : 1}>
          {group.parts.map((part, j) => {
            if (part.type === "reasoning") {
              return (
                <box
                  key={`reasoning-${j}`}
                  border={["left"]}
                  borderColor={colors.thinkingBorder}
                  width="100%"
                  paddingX={2}
                >
                  <text attributes={TextAttributes.DIM}>
                    <em fg={colors.thinking}>Thinking:</em> {part.text}
                  </text>
                </box>
              );
            }
            if (isToolPart(part)) {
              const toolName =
                part.type === "dynamic-tool"
                  ? part.toolName
                  : part.type.slice("tool-".length);
              return (
                <box
                  key={part.toolCallId}
                  border={["left"]}
                  borderColor={colors.thinkingBorder}
                  width="100%"
                  paddingX={2}
                >
                  <text attributes={TextAttributes.DIM}>
                    <em fg={colors.info}>{formatToolName(toolName)}:</em>{" "}
                    {formatToolArgs(part)}
                    {formatToolResult(part)}
                  </text>
                </box>
              );
            }
            if (part.type === "text") {
              return (
                <box key={`text-${j}`} paddingX={3} width="100%">
                  <text>{part.text}</text>
                </box>
              );
            }
            return null;
          })}
        </box>
      ))}
      <box paddingX={3} paddingY={1} gap={1} width="100%">
        <box flexDirection="row" gap={2}>
          <box flexDirection="row" gap={1}>
            <text
              attributes={interrupted ? TextAttributes.DIM : 0}
              fg={
                interrupted
                  ? undefined
                  : mode === Mode.PLAN
                    ? colors.planMode
                    : colors.primary
              }
            >
              ◉
            </text>
            <text attributes={interrupted ? TextAttributes.DIM : 0}>
              {mode === Mode.PLAN ? "Plan" : "Build"}
            </text>
            <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
              ›
            </text>
            <text attributes={TextAttributes.DIM}>{model}</text>
            {(durationMs != null || interrupted) && (
              <>
                <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                  ›
                </text>
                <text attributes={TextAttributes.DIM}>
                  {interrupted || durationMs == null
                    ? "interrupted"
                    : prettyMs(durationMs)}
                </text>
              </>
            )}
          </box>
        </box>
      </box>
    </box>
  );
}
