import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { GateBadge, SeverityBadge, StageStatusBadge, StatusBadge } from "./badges";

describe("status badges", () => {
  it("renders run status labels", () => {
    render(<StatusBadge status="waiting-approval" />);
    expect(screen.getByText("Waiting Approval")).toBeInTheDocument();
  });

  it("renders stage status labels", () => {
    render(<StageStatusBadge status="blocked" />);
    expect(screen.getByText("Blocked")).toBeInTheDocument();
  });

  it("renders severity labels", () => {
    render(<SeverityBadge severity="critical" />);
    expect(screen.getByText("Critical")).toBeInTheDocument();
  });

  it("renders security gate results", () => {
    render(<GateBadge gate="failed" />);
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });
});
