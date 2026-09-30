import { Outlet } from "react-router";
import { DialogProvider } from "../providers/dialog";
import { ThemedRoot } from "./themed-root";
import { PromptConfigProvider } from "../providers/prompt-config";

export function RootLayout() {
  return (
    <DialogProvider>
      <PromptConfigProvider>
        <ThemedRoot>
          <Outlet />
        </ThemedRoot>
      </PromptConfigProvider>
    </DialogProvider>
  );
}
