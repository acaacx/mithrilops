import * as httpProviders from "./http";
import * as mockProviders from "./mock";

/**
 * Provider factory. VITE_DATA_SOURCE=memory selects the in-memory mock
 * implementations (vitest + the memory-mode Playwright project); anything
 * else — including unset — selects HTTP against the FastAPI backend.
 */
export type DataSource = "http" | "memory";

export const dataSource: DataSource =
  import.meta.env.VITE_DATA_SOURCE === "memory" ? "memory" : "http";

const impl = dataSource === "memory" ? mockProviders : httpProviders;

export const pipelineProvider = impl.pipelineProvider;
export const securityProvider = impl.securityProvider;
export const deploymentProvider = impl.deploymentProvider;
export const infrastructureProvider = impl.infrastructureProvider;
export const complianceProvider = impl.complianceProvider;
export const architectureProvider = impl.architectureProvider;
export const auditProvider = impl.auditProvider;
export const integrationProvider = impl.integrationProvider;

export { mockState } from "./mock-state";
