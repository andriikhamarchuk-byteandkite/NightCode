import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { RootLayout } from "./layouts/root-layout";
import { RouteError } from "./layouts/route-error";
import { KeyboardLayerProvider } from "./providers/keyboard-layer";
import { ThemeProvider } from "./providers/theme";
import { ToastProvider } from "./providers/toast";
import { Home } from "./screens/home";
import { NewSession } from "./screens/new-session";
import { Session } from "./screens/session";

const router = createMemoryRouter([
  {
    path: "/",
    element: <RootLayout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Home /> },
      { path: "sessions/new", element: <NewSession /> },
      { path: "sessions/:id", element: <Session /> },
    ],
  },
]);

// Theme, toast and keyboard providers sit above the router so the route error
// screen stays themed and Ctrl+C keeps working there. Dialog and prompt config
// live in RootLayout because dialog content uses router hooks.
function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <KeyboardLayerProvider>
          <RouterProvider router={router} />
        </KeyboardLayerProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

const renderer = await createCliRenderer({
  targetFps: 60,
  exitOnCtrlC: false,
});
createRoot(renderer).render(<App />);
