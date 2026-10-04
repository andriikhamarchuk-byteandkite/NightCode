import { Mode } from "@nightcode/database/enums";
import type { ThemeColors } from "../theme";

export function getModeLabel(mode: Mode) {
  return mode === Mode.PLAN ? "Plan" : "Build";
}

export function getModeColor(mode: Mode, colors: ThemeColors) {
  return mode === Mode.PLAN ? colors.planMode : colors.primary;
}
