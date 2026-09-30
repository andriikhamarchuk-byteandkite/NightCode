import { isRouteErrorResponse, useRouteError } from "react-router";
import { ErrorMessage } from "../components/messages/error-message";
import { ThemedRoot } from "./themed-root";

export function RouteError() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : String(error);

  return (
    <ThemedRoot>
      <box padding={2}>
        <ErrorMessage message={message} />
      </box>
    </ThemedRoot>
  );
}
