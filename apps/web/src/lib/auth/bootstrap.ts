import { fetchRuntimeConfig } from "@/lib/auth/config";
import { dataSource } from "@/lib/providers";
import { useSession } from "@/stores/session";

export interface BootstrapIO {
  renderApp: () => void;
  renderError: (message: string) => void;
}

/**
 * Decides how the SPA starts: demo mode straight to the app, auth mode
 * through runtime config + MSAL, or a fail-closed error splash if either
 * step breaks. Pulled out of main.tsx so the branching is testable without
 * a real DOM root.
 */
export async function bootstrap(io: BootstrapIO): Promise<void> {
  const { renderApp, renderError } = io;

  // Memory mode has no API to ask; it is always the demo experience.
  if (dataSource === "memory") return renderApp();

  let config;
  try {
    config = await fetchRuntimeConfig();
  } catch (error) {
    console.error(error);
    return renderError("Could not load runtime configuration from the API.");
  }
  if (!config.authEnabled) return renderApp();

  try {
    const { initAuth } = await import("@/lib/auth/msal");
    const account = await initAuth(config);
    if (!account) return; // loginRedirect is navigating away
    useSession.getState().setAuthSession(account.name, account.roles);
    renderApp();
  } catch (error) {
    console.error(error);
    renderError("Sign-in failed. Check the Microsoft Entra ID configuration.");
  }
}
