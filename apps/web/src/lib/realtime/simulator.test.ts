import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { mockState } from "@/lib/providers/mock-state";
import { tick } from "./simulator";

const RUN_ID = "run-0512";

function getRun() {
  const run = mockState.runs.find((r) => r.id === RUN_ID);
  if (!run) throw new Error("simulated run missing from mock state");
  return run;
}

describe("pipeline simulator state transitions", () => {
  it("advances the running stage to succeeded and starts the next stage", () => {
    const qc = new QueryClient();
    const run = getRun();
    expect(run.status).toBe("running");
    const beforeIdx = run.stages.findIndex((s) => s.status === "running");
    expect(beforeIdx).toBeGreaterThanOrEqual(0);

    tick(qc);

    const before = run.stages[beforeIdx]!;
    expect(before.status).toBe("succeeded");
    expect(before.finishedAt).toBeDefined();
    const nowRunning = run.stages.findIndex((s) => s.status === "running");
    expect(nowRunning).toBeGreaterThan(beforeIdx);
  });

  it("seals evidence for gate stages when they complete", () => {
    const run = getRun();
    const completedGates = run.stages.filter((s) => s.status === "succeeded" && s.blocksDeployment);
    for (const g of completedGates) {
      expect(g.evidenceIds.length).toBeGreaterThan(0);
    }
  });

  it("eventually completes the dev loop and marks the run succeeded", () => {
    const qc = new QueryClient();
    // Drive the simulator to the end of the loop (bounded iterations).
    for (let i = 0; i < 40 && getRun().status === "running"; i++) tick(qc);
    const run = getRun();
    expect(run.status).toBe("succeeded");
    expect(run.securityGate).toBe("passed");
    expect(run.finishedAt).toBeDefined();
    // No stage may be left dangling in running state.
    expect(run.stages.some((s) => s.status === "running")).toBe(false);
  });
});
