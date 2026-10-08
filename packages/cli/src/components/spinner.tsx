import "opentui-spinner/react";
import { useTheme } from "../providers/theme";
import { Mode, type ModeType } from "@nightcode/shared";
import { getModeColor } from "../lib/mode";

type Props = {
  mode?: ModeType;
};

export function Spinner({ mode = Mode.BUILD }: Props) {
  const { colors } = useTheme();

  return <spinner name="aesthetic" color={getModeColor(mode, colors)} />;
}
