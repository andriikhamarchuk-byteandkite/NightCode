import { Outlet } from "react-router";
import { ThemedRoot } from "./themed-root";

export function RootLayout() {
  return (
    <ThemedRoot>
      <Outlet />
    </ThemedRoot>
  );
}
