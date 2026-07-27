import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, GitPullRequest, RefreshCcw, Save, Wand2 } from "lucide-react";
import {
  ENVIRONMENTS,
  FRAMEWORKS,
  SCANNERS,
  generatorRequestSchema,
  type GeneratorRequest,
  type GeneratorResult,
} from "@secureflow/types";
import { PageHeader } from "@/components/domain/page-header";
import { AIPanel } from "@/components/domain/ai-panel";
import { ArchitectureFlow } from "@/components/domain/architecture-flow";
import { CodeViewer } from "@/components/domain/log-viewer";
import { SeverityBadge } from "@/components/domain/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FieldError, Input, Label, Select, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useGeneratePipeline } from "@/lib/queries";
import { formatUsd, titleCase } from "@/lib/utils";
import { toast } from "sonner";
import type { Severity } from "@secureflow/types";

const DEFAULTS: GeneratorRequest = {
  applicationName: "Payments Ledger API",
  repository: "meridian/payments-ledger-api",
  applicationType: "api",
  language: "typescript",
  deploymentModel: "containerized",
  targetService: "aks",
  environments: ["development", "staging", "production"],
  complianceRequirements: ["pci-dss", "soc-2"],
  availabilityTarget: "99.95",
  deploymentStrategy: "canary",
  riskTolerance: "low",
  requiredScanners: ["gitleaks", "snyk", "sonarqube", "trivy", "checkov", "owasp-zap"],
  approvalModel: "security-plus-release",
  requirements:
    "Deploy the payments ledger API to AKS using a private endpoint, Azure Key Vault, managed identity, autoscaling, and production-grade monitoring. PCI scope; dual approval for production.",
};

export default function GeneratorPage() {
  const generate = useGeneratePipeline();
  const [result, setResult] = useState<GeneratorResult | null>(null);

  const form = useForm<GeneratorRequest>({
    resolver: zodResolver(generatorRequestSchema),
    defaultValues: DEFAULTS,
  });

  const submit = form.handleSubmit((values) => {
    generate.mutate(values, { onSuccess: setResult });
  });

  const err = form.formState.errors;

  return (
    <div className="mx-auto max-w-[1500px] p-6 rise-in">
      <PageHeader
        title="AI pipeline generator"
        subtitle="Describe the application in natural language — get a governed architecture, pipeline, and Terraform scaffold"
      />

      <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
        <Card className="self-start">
          <CardHeader title="Deployment intent" subtitle="All generation is simulated and deterministic in this build" />
          <CardBody>
            <form onSubmit={submit} className="space-y-3">
              <div>
                <Label htmlFor="g-name">Application name</Label>
                <Input id="g-name" {...form.register("applicationName")} />
                <FieldError message={err.applicationName?.message} />
              </div>
              <div>
                <Label htmlFor="g-repo">Repository</Label>
                <Input id="g-repo" {...form.register("repository")} />
                <FieldError message={err.repository?.message} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="g-type">Application type</Label>
                  <Select id="g-type" {...form.register("applicationType")}>
                    {["api", "web-frontend", "worker", "batch-job", "event-processor"].map((t) => (
                      <option key={t} value={t}>{titleCase(t)}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="g-lang">Language</Label>
                  <Select id="g-lang" {...form.register("language")}>
                    {["typescript", "csharp", "java", "python", "go"].map((l) => (
                      <option key={l} value={l}>{titleCase(l)}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="g-model">Deployment model</Label>
                  <Select id="g-model" {...form.register("deploymentModel")}>
                    <option value="containerized">Containerized</option>
                    <option value="serverless">Serverless</option>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="g-target">Target Azure service</Label>
                  <Select id="g-target" {...form.register("targetService")}>
                    <option value="aks">AKS</option>
                    <option value="container-apps">Container Apps</option>
                    <option value="app-service">App Service</option>
                    <option value="functions">Functions</option>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="g-avail">Availability target</Label>
                  <Select id="g-avail" {...form.register("availabilityTarget")}>
                    {["99.0", "99.9", "99.95", "99.99"].map((a) => <option key={a} value={a}>{a}%</option>)}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="g-strategy">Deployment strategy</Label>
                  <Select id="g-strategy" {...form.register("deploymentStrategy")}>
                    <option value="rolling">Rolling</option>
                    <option value="canary">Canary</option>
                    <option value="blue-green">Blue/green</option>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="g-risk">Risk tolerance</Label>
                  <Select id="g-risk" {...form.register("riskTolerance")}>
                    <option value="low">Low (strict gates)</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="g-approval">Approval model</Label>
                  <Select id="g-approval" {...form.register("approvalModel")}>
                    <option value="single-approver">Single approver</option>
                    <option value="dual-approval">Dual approval</option>
                    <option value="security-plus-release">Security + Release</option>
                  </Select>
                </div>
              </div>

              <fieldset>
                <legend className="mb-1 text-xs font-medium text-fg-muted">Environments</legend>
                <div className="flex flex-wrap gap-2">
                  {ENVIRONMENTS.map((e) => (
                    <label key={e} className="flex cursor-pointer items-center gap-1.5 rounded border border-line bg-surface-2 px-2 py-1 text-xs text-fg-muted has-checked:border-accent has-checked:text-fg">
                      <input type="checkbox" value={e} {...form.register("environments")} className="accent-(--accent)" />
                      {titleCase(e)}
                    </label>
                  ))}
                </div>
                <FieldError message={err.environments?.message} />
              </fieldset>

              <fieldset>
                <legend className="mb-1 text-xs font-medium text-fg-muted">Compliance requirements</legend>
                <div className="flex flex-wrap gap-2">
                  {FRAMEWORKS.map((f) => (
                    <label key={f} className="flex cursor-pointer items-center gap-1.5 rounded border border-line bg-surface-2 px-2 py-1 text-xs text-fg-muted has-checked:border-accent has-checked:text-fg">
                      <input type="checkbox" value={f} {...form.register("complianceRequirements")} className="accent-(--accent)" />
                      {titleCase(f)}
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <legend className="mb-1 text-xs font-medium text-fg-muted">Required scanners</legend>
                <div className="flex flex-wrap gap-2">
                  {SCANNERS.filter((s) => !["defender-for-cloud", "kube-bench", "syft", "cosign"].includes(s)).map((s) => (
                    <label key={s} className="flex cursor-pointer items-center gap-1.5 rounded border border-line bg-surface-2 px-2 py-1 text-xs text-fg-muted has-checked:border-accent has-checked:text-fg">
                      <input type="checkbox" value={s} {...form.register("requiredScanners")} className="accent-(--accent)" />
                      {s}
                    </label>
                  ))}
                </div>
              </fieldset>

              <div>
                <Label htmlFor="g-req">Natural-language requirements</Label>
                <Textarea id="g-req" rows={4} {...form.register("requirements")} />
                <FieldError message={err.requirements?.message} />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="submit" variant="primary" disabled={generate.isPending}>
                  <Wand2 size={14} /> {generate.isPending ? "Generating…" : result ? "Regenerate" : "Generate"}
                </Button>
                {result && (
                  <>
                    <Button type="button" variant="secondary" onClick={() => toast.info("Architecture editor (simulated)")}>Edit architecture</Button>
                    <Button type="button" variant="secondary" onClick={() => toast.info("Pipeline editor (simulated)")}>Edit pipeline</Button>
                    <Button type="button" variant="secondary" onClick={() => toast.success("Validation passed", { description: "Plan satisfies org baseline policy prod-baseline-v9." })}>
                      <Check size={14} /> Validate
                    </Button>
                  </>
                )}
              </div>
            </form>
          </CardBody>
        </Card>

        <div className="min-w-0 space-y-4">
          {generate.isPending && (
            <>
              <Skeleton className="h-10 w-2/3" />
              <Skeleton className="h-96" />
            </>
          )}
          {!generate.isPending && !result && (
            <Card className="flex min-h-96 flex-col items-center justify-center gap-3 p-8 text-center">
              <Wand2 size={28} className="text-fg-faint" aria-hidden />
              <p className="text-sm font-medium text-fg-muted">Describe your application and generate a secure delivery plan</p>
              <p className="max-w-md text-xs text-fg-faint">
                The generator proposes architecture, a full DevSecOps pipeline, Terraform layout, workflow YAML, security policy, cost, and risks — mapped to your compliance scope.
              </p>
            </Card>
          )}
          {result && !generate.isPending && (
            <>
              <AIPanel recommendation={result.aiRecommendation} />
              <Tabs defaultValue="architecture">
                <TabsList>
                  <TabsTrigger value="architecture">Architecture</TabsTrigger>
                  <TabsTrigger value="pipeline">Pipeline ({result.pipelineStages.length})</TabsTrigger>
                  <TabsTrigger value="terraform">Terraform</TabsTrigger>
                  <TabsTrigger value="workflow">Workflow</TabsTrigger>
                  <TabsTrigger value="policy">Security policy</TabsTrigger>
                  <TabsTrigger value="risks">Risks & cost</TabsTrigger>
                  <TabsTrigger value="checklist">Checklist</TabsTrigger>
                </TabsList>

                <TabsContent value="architecture">
                  <ArchitectureFlow
                    diagram={{
                      id: result.id,
                      applicationId: "generated",
                      nodes: result.architecture.components.map((c) => ({
                        id: c.id,
                        label: c.label,
                        kind: c.kind,
                        status: "unknown" as const,
                        owner: "Proposed",
                        description: c.rationale,
                        findingsCount: 0,
                        dependencies: result.architecture.edges.filter((e) => e.target === c.id).map((e) => e.source),
                        relatedStageDefinitionIds: [],
                      })),
                      edges: result.architecture.edges.map((e, i) => ({ id: `ge-${i}`, ...e })),
                    }}
                  />
                </TabsContent>

                <TabsContent value="pipeline">
                  <Card>
                    <ol className="divide-y divide-line/60">
                      {result.pipelineStages.map((s, i) => (
                        <li key={s.id} className="flex items-center gap-3 px-4 py-2">
                          <span className="w-6 shrink-0 text-right font-mono text-xs text-fg-faint">{i + 1}</span>
                          <span className="min-w-0 flex-1 truncate text-sm text-fg">{s.name}</span>
                          <span className="text-xs text-fg-faint">{s.tool}</span>
                          {s.gate && <Badge color="var(--warn)">gate</Badge>}
                          <Badge color="var(--pending)">{s.phase}</Badge>
                        </li>
                      ))}
                    </ol>
                  </Card>
                </TabsContent>

                <TabsContent value="terraform">
                  <CodeViewer code={result.terraformFileTree.join("\n")} />
                </TabsContent>

                <TabsContent value="workflow">
                  <CodeViewer code={result.workflowYaml} className="max-h-[480px]" />
                </TabsContent>

                <TabsContent value="policy">
                  <Card>
                    <ul className="divide-y divide-line/60">
                      {result.securityPolicy.map((p) => (
                        <li key={p.control} className="flex items-center justify-between gap-3 px-4 py-2.5">
                          <span className="text-sm text-fg">{p.control}</span>
                          <span className="font-mono text-xs text-fg-muted">{p.setting}</span>
                        </li>
                      ))}
                    </ul>
                  </Card>
                  <p className="mt-2 text-xs text-fg-faint">
                    Required integrations: {result.requiredIntegrations.join(", ")}
                  </p>
                </TabsContent>

                <TabsContent value="risks">
                  <Card className="mb-3 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-faint">Estimated infrastructure cost</p>
                    <p className="mt-1 font-mono text-2xl font-semibold text-fg">{formatUsd(result.monthlyCostEstimateUsd)}<span className="text-sm text-fg-faint">/month</span></p>
                  </Card>
                  <Card>
                    <ul className="divide-y divide-line/60">
                      {result.identifiedRisks.map((r) => (
                        <li key={r.risk} className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <SeverityBadge severity={r.severity as Severity} />
                            <p className="text-sm font-medium text-fg">{r.risk}</p>
                          </div>
                          <p className="mt-1 text-xs text-fg-muted">Mitigation: {r.mitigation}</p>
                        </li>
                      ))}
                    </ul>
                  </Card>
                </TabsContent>

                <TabsContent value="checklist">
                  <Card>
                    <ol className="divide-y divide-line/60">
                      {result.implementationChecklist.map((item, i) => (
                        <li key={i} className="flex items-start gap-3 px-4 py-2.5">
                          <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-line font-mono text-[10px] text-fg-faint">{i + 1}</span>
                          <span className="text-sm text-fg-muted">{item}</span>
                        </li>
                      ))}
                    </ol>
                  </Card>
                </TabsContent>
              </Tabs>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  onClick={() =>
                    toast.success("Pull request drafted (simulated)", {
                      description: `Scaffold PR prepared for ${result.request.repository} — in production this opens on GitHub for review.`,
                    })
                  }
                >
                  <GitPullRequest size={14} /> Create pull request
                </Button>
                <Button variant="secondary" onClick={() => toast.success("Saved as template (simulated)")}>
                  <Save size={14} /> Save as template
                </Button>
                <Button variant="ghost" onClick={submit} disabled={generate.isPending}>
                  <RefreshCcw size={14} /> Regenerate
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
