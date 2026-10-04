import { TextAttributes } from "@opentui/core";
import { useTheme } from "../providers/theme";
import { usePromptConfig } from "../providers/prompt-config";
import { getModeColor, getModeLabel } from "../lib/mode";

export function StatusBar() {
  const { mode, model } = usePromptConfig();
  const { colors } = useTheme();
  return (
    <box flexDirection="row" gap={1}>
      <text fg={getModeColor(mode, colors)}>{getModeLabel(mode)}</text>

      <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
        ›
      </text>
      <text>{model}</text>
    </box>
  );
}
