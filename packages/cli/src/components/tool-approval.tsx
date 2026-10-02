import { useEffect, useRef } from "react";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useKeyboardLayer } from "../providers/keyboard-layer";
import { useTheme } from "../providers/theme";
import type { ToolApprovalRequest } from "../hooks/use-chat";

const LAYER_ID = "tool-approval";
const MAX_VALUE_LENGTH = 500;

type Props = {
  request: ToolApprovalRequest;
  onRespond: (approved: boolean) => void;
};

function formatToolName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

function formatValue(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > MAX_VALUE_LENGTH
    ? `${text.slice(0, MAX_VALUE_LENGTH)}… (${text.length} chars)`
    : text;
}

function formatInput(input: unknown): [string, string][] {
  if (input == null || typeof input !== "object") {
    return [["input", formatValue(input)]];
  }

  return Object.entries(input).map(([name, value]) => [
    name,
    formatValue(value),
  ]);
}

export function ToolApproval({ request, onRespond }: Props) {
  const { colors } = useTheme();
  const { push, pop, isTopLayer } = useKeyboardLayer();
  const onRespondRef = useRef(onRespond);
  onRespondRef.current = onRespond;

  // Own layer, so the input bar loses focus and esc does not interrupt the
  // turn while the user decides. Ctrl+C rejects instead of quitting.
  useEffect(() => {
    push(LAYER_ID, () => {
      onRespondRef.current(false);
      return true;
    });
    return () => pop(LAYER_ID);
  }, [push, pop]);

  useKeyboard((key) => {
    if (!isTopLayer(LAYER_ID)) return;

    if (key.name === "y" || key.name === "return" || key.name === "enter") {
      key.preventDefault();
      onRespond(true);
    }

    if (key.name === "n" || key.name === "escape") {
      key.preventDefault();
      onRespond(false);
    }
  });

  return (
    <box border={["left"]} borderColor={colors.primary} width="100%">
      <box
        paddingX={2}
        paddingY={1}
        gap={1}
        backgroundColor={colors.surface}
        width="100%"
      >
        <text>
          Allow <em fg={colors.info}>{formatToolName(request.toolName)}</em>{" "}
          to run?
        </text>
        <box>
          {formatInput(request.input).map(([name, value]) => (
            <text key={name} attributes={TextAttributes.DIM}>
              {name}: {value}
            </text>
          ))}
        </box>
        <box flexDirection="row" gap={2}>
          <box flexDirection="row" gap={1}>
            <text>y</text>
            <text attributes={TextAttributes.DIM}>allow</text>
          </box>
          <box flexDirection="row" gap={1}>
            <text>n</text>
            <text attributes={TextAttributes.DIM}>reject</text>
          </box>
        </box>
      </box>
    </box>
  );
}
