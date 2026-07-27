import { describe, expect, it } from "vitest";
import { pipelineRuns, securityFindings, auditEvents } from "@secureflow/mock-data";
import { filterAndSortFindings, filterAndSortRuns, sortAuditEvents } from "./filters";

describe("filterAndSortRuns", () => {
  it("sorts by startedAt descending", () => {
    const runs = filterAndSortRuns([...pipelineRuns]);
    for (let i = 1; i < runs.length; i++) {
      expect(new Date(runs[i - 1]!.startedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(runs[i]!.startedAt).getTime(),
      );
    }
  });

  it("filters by status and free-text search on sha prefix", () => {
    const failed = filterAndSortRuns([...pipelineRuns], { status: "failed" });
    expect(failed.length).toBeGreaterThan(0);
    expect(failed.every((r) => r.status === "failed")).toBe(true);
    const target = pipelineRuns[0]!;
    const bySha = filterAndSortRuns([...pipelineRuns], { search: target.commit.sha.slice(0, 6) });
    expect(bySha.some((r) => r.id === target.id)).toBe(true);
  });
});

describe("filterAndSortFindings", () => {
  it("sorts by severity order", () => {
    const order = { critical: 0, high: 1, medium: 2, low: 3, informational: 4 };
    const findings = filterAndSortFindings([...securityFindings]);
    for (let i = 1; i < findings.length; i++) {
      expect(order[findings[i - 1]!.severity]).toBeLessThanOrEqual(order[findings[i]!.severity]);
    }
  });

  it("filters by frameworkId via compliance mappings", () => {
    const owasp = filterAndSortFindings([...securityFindings], { frameworkId: "owasp-top-10" });
    expect(owasp.length).toBeGreaterThan(0);
    expect(
      owasp.every((f) => f.complianceMappings.some((m) => m.frameworkId === "owasp-top-10")),
    ).toBe(true);
  });
});

describe("sortAuditEvents", () => {
  it("sorts descending and respects limit", () => {
    const events = sortAuditEvents([...auditEvents], 3);
    expect(events).toHaveLength(3);
    expect(new Date(events[0]!.timestamp).getTime()).toBeGreaterThanOrEqual(
      new Date(events[1]!.timestamp).getTime(),
    );
  });
});
