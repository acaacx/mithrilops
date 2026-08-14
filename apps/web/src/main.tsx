import "@fontsource-variable/ibm-plex-sans";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { bootstrap } from "@/lib/auth/bootstrap";

const root = createRoot(document.getElementById("root")!);

function renderApp() {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

// Fail closed: a broken /api/config or MSAL setup shows this splash rather
// than silently dropping to the unauthenticated demo experience.
function renderError(message: string) {
  root.render(
    <StrictMode>
      <div className="grid min-h-screen place-items-center bg-canvas p-6">
        <div className="max-w-md rounded-lg border border-line bg-surface p-6 text-center">
          <h1 className="text-lg font-semibold text-fg">SecureFlow could not start</h1>
          <p className="mt-2 text-sm text-fg-muted">{message}</p>
        </div>
      </div>
    </StrictMode>,
  );
}

void bootstrap({ renderApp, renderError });
