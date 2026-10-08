import { Mode, type ModeType } from "@nightcode/shared";
import type { ThemeColors } from "../theme";

export function getModeLabel(mode: ModeType) {
  return mode === Mode.PLAN ? "Plan" : "Build";
}

export function getModeColor(mode: ModeType, colors: ThemeColors) {
  return mode === Mode.PLAN ? colors.planMode : colors.primary;
}
