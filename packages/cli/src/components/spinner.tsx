import "opentui-spinner/react";
import { useTheme } from "../providers/theme";
import { Mode } from "@nightcode/database/enums";

type Props = {
  mode?: Mode;
};

export function Spinner({ mode = Mode.BUILD }: Props) {
  const { colors } = useTheme();
  const activeColor = mode === Mode.BUILD ? colors.primary : colors.planMode;

  return <spinner name="aesthetic" color={activeColor} />;
}
