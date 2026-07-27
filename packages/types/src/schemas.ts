import { z } from "zod";
import { ENVIRONMENTS, FRAMEWORKS, SCANNERS } from "./enums";
import type { AIRecommendation, PipelineStageDefinition } from "./entities";

export const approvalRequestSchema = z.object({
  decision: z.enum(["approved", "rejected", "changes-requested"]),
  comment: z.string().min(3, "A justification comment is required").max(2000),
  environment: z.enum(ENVIRONMENTS),
});
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;

export const riskAcceptanceSchema = z.object({
  reason: z.string().min(10, "Documented business justification is required").max(2000),
  expiresAt: z.string().min(1, "An expiry date is required"),
});
export type RiskAcceptanceRequest = z.infer<typeof riskAcceptanceSchema>;

export const generatorRequestSchema = z.object({
  applicationName: z.string().min(2, "Application name is required").max(60),
  repository: z.string().min(2, "Repository is required"),
  applicationType: z.enum(["api", "web-frontend", "worker", "batch-job", "event-processor"]),
  language: z.enum(["typescript", "csharp", "java", "python", "go"]),
  deploymentModel: z.enum(["containerized", "serverless"]),
  targetService: z.enum(["aks", "container-apps", "app-service", "functions"]),
  environments: z.array(z.enum(ENVIRONMENTS)).min(1, "Select at least one environment"),
  complianceRequirements: z.array(z.enum(FRAMEWORKS)),
  availabilityTarget: z.enum(["99.0", "99.9", "99.95", "99.99"]),
  deploymentStrategy: z.enum(["rolling", "canary", "blue-green"]),
  riskTolerance: z.enum(["low", "medium", "high"]),
  requiredScanners: z.array(z.enum(SCANNERS)),
  approvalModel: z.enum(["single-approver", "dual-approval", "security-plus-release"]),
  requirements: z.string().min(10, "Describe what you need in natural language").max(4000),
});
export type GeneratorRequest = z.infer<typeof generatorRequestSchema>;

export interface GeneratorArchitectureComponent {
  id: string;
  label: string;
  kind: string;
  rationale: string;
}

export interface GeneratorResult {
  id: string;
  request: GeneratorRequest;
  architecture: {
    components: GeneratorArchitectureComponent[];
    edges: { source: string; target: string; label?: string }[];
  };
  pipelineStages: PipelineStageDefinition[];
  terraformFileTree: string[];
  workflowYaml: string;
  securityPolicy: { control: string; setting: string }[];
  requiredIntegrations: string[];
  monthlyCostEstimateUsd: number;
  identifiedRisks: { risk: string; severity: string; mitigation: string }[];
  implementationChecklist: string[];
  aiRecommendation: AIRecommendation;
}
