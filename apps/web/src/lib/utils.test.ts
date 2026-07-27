import { describe, expect, it } from "vitest";
import { formatDuration, formatUsd, shortSha, titleCase } from "./utils";

describe("formatDuration", () => {
  it("handles undefined", () => expect(formatDuration(undefined)).toBe("—"));
  it("formats seconds", () => expect(formatDuration(45)).toBe("45s"));
  it("formats minutes and seconds", () => expect(formatDuration(125)).toBe("2m 5s"));
  it("formats whole minutes", () => expect(formatDuration(120)).toBe("2m"));
  it("formats hours", () => expect(formatDuration(3720)).toBe("1h 2m"));
});

describe("shortSha", () => {
  it("truncates to 7 chars", () => expect(shortSha("8f3ec2a91d4b7c05")).toBe("8f3ec2a"));
});

describe("titleCase", () => {
  it("converts kebab-case", () => expect(titleCase("waiting-approval")).toBe("Waiting Approval"));
  it("handles single words", () => expect(titleCase("running")).toBe("Running"));
});

describe("formatUsd", () => {
  it("formats whole dollars", () => expect(formatUsd(4180)).toBe("$4,180"));
});
