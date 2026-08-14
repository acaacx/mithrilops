import { describe, expect, it } from "vitest";
import { useSession } from "./session";

describe("session store", () => {
  it("defaults to demo mode with a single role", () => {
    const s = useSession.getState();
    expect(s.roles).toEqual(["devsecops-engineer"]);
    expect(s.authMode).toBe(false);
    expect(s.userName).toBe("Rowan Ashford");
  });

  it("setRole replaces the roles array (demo switcher)", () => {
    useSession.getState().setRole("release-approver");
    expect(useSession.getState().roles).toEqual(["release-approver"]);
  });

  it("setAuthSession sets identity, roles, and authMode", () => {
    useSession.getState().setAuthSession("Ada Lovelace", ["developer", "release-approver"]);
    const s = useSession.getState();
    expect(s.authMode).toBe(true);
    expect(s.userName).toBe("Ada Lovelace");
    expect(s.roles).toEqual(["developer", "release-approver"]);
  });
});
