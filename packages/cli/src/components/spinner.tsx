import "opentui-spinner/react";
import { useTheme } from "../providers/theme";
import { Mode } from "@nightcode/database/enums";
import { getModeColor } from "../lib/mode";

type Props = {
  mode?: Mode;
};

export function Spinner({ mode = Mode.BUILD }: Props) {
  const { colors } = useTheme();

  return <spinner name="aesthetic" color={getModeColor(mode, colors)} />;
}
