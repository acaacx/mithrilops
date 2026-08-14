import "@fontsource-variable/ibm-plex-sans";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { fetchRuntimeConfig } from "@/lib/auth/config";
import { dataSource } from "@/lib/providers";
import { useSession } from "@/stores/session";

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

async function bootstrap() {
  // Memory mode has no API to ask; it is always the demo experience.
  if (dataSource === "memory") return renderApp();

  let config;
  try {
    config = await fetchRuntimeConfig();
  } catch {
    return renderError("Could not load runtime configuration from the API.");
  }
  if (!config.authEnabled) return renderApp();

  try {
    const { initAuth } = await import("@/lib/auth/msal");
    const account = await initAuth(config);
    if (!account) return; // loginRedirect is navigating away
    useSession.getState().setAuthSession(account.name, account.roles);
    renderApp();
  } catch {
    renderError("Sign-in failed. Check the Microsoft Entra ID configuration.");
  }
}

void bootstrap();
