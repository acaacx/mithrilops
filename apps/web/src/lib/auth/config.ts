export interface RuntimeConfig {
  authEnabled: boolean;
  tenantId: string;
  clientId: string;
}

/** Reads the server's auth posture. Throws on failure — bootstrap fails closed. */
export async function fetchRuntimeConfig(): Promise<RuntimeConfig> {
  const response = await fetch("/api/config");
  if (!response.ok) {
    throw new Error(`config fetch failed: ${response.status}`);
  }
  return (await response.json()) as RuntimeConfig;
}
