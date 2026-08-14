import { InteractionRequiredAuthError, PublicClientApplication } from "@azure/msal-browser";
import { ROLES, type Role } from "@secureflow/types";
import type { RuntimeConfig } from "./config";
import { registerTokenGetter, registerUnauthorizedHandler } from "./token";

export interface AuthAccount {
  name: string;
  roles: Role[];
}

let pca: PublicClientApplication | null = null;
let scopes: string[] = [];
let redirecting = false;

/**
 * Constructs the MSAL singleton, completes any pending redirect, and either
 * returns the signed-in account or starts a loginRedirect (returning null —
 * the page is navigating away). Only ever imported dynamically, and only when
 * /api/config reports authEnabled.
 */
export async function initAuth(config: RuntimeConfig): Promise<AuthAccount | null> {
  scopes = [`api://${config.clientId}/access`];
  pca = new PublicClientApplication({
    auth: {
      clientId: config.clientId,
      authority: `https://login.microsoftonline.com/${config.tenantId}`,
      redirectUri: window.location.origin,
      postLogoutRedirectUri: window.location.origin,
    },
    cache: { cacheLocation: "sessionStorage" },
  });
  await pca.initialize();
  const result = await pca.handleRedirectPromise();
  const account = result?.account ?? pca.getAllAccounts()[0] ?? null;
  if (!account) {
    await pca.loginRedirect({ scopes });
    return null;
  }
  pca.setActiveAccount(account);
  registerTokenGetter(acquireToken);
  redirecting = false;
  registerUnauthorizedHandler(() => {
    if (redirecting) return;
    redirecting = true;
    pca?.acquireTokenRedirect({ scopes }).catch(() => {
      redirecting = false;
    });
  });
  const claims = (account.idTokenClaims ?? {}) as {
    name?: string;
    preferred_username?: string;
    roles?: string[];
  };
  const roles = (claims.roles ?? []).filter((r): r is Role =>
    (ROLES as readonly string[]).includes(r),
  );
  return { name: claims.name ?? claims.preferred_username ?? account.username, roles };
}

async function acquireToken(): Promise<string | null> {
  if (!pca) return null;
  try {
    return (await pca.acquireTokenSilent({ scopes })).accessToken;
  } catch (error) {
    if (error instanceof InteractionRequiredAuthError) {
      await pca.acquireTokenRedirect({ scopes });
      return null;
    }
    throw error;
  }
}

export async function signOut(): Promise<void> {
  await pca?.logoutRedirect();
}
