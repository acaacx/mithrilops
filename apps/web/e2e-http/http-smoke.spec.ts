import { expect, test } from "@playwright/test";

const API = "http://127.0.0.1:4000";

test("overview renders with data fetched from the API", async ({ page }) => {
  const applications = page.waitForResponse(
    (r) => r.url().includes("/api/applications") && r.status() === 200,
  );
  await page.goto("/");
  await applications;
  await expect(page.getByRole("heading", { name: "Executive overview" })).toBeVisible();
});

test("pipelines list shows runs served by the API", async ({ page }) => {
  const runsResponse = page.waitForResponse(
    (r) =>
      r.url().includes("/api/runs") && !r.url().includes("/stages/") && r.status() === 200,
  );
  await page.goto("/pipelines");
  const runs = (await (await runsResponse).json()) as { id: string }[];
  expect(runs.length).toBeGreaterThan(0);
  // The pipelines table renders each run's id as a link (see
  // apps/web/src/pages/pipelines.tsx) — commit messages are not shown there.
  await expect(page.getByRole("link", { name: runs[0]!.id }).first()).toBeVisible();
});

test("finding status mutation round-trips through the API", async ({ request }) => {
  const findings = (await (await request.get(`${API}/api/findings`)).json()) as {
    id: string;
    status: string;
  }[];
  const target = findings.find((f) => f.status === "open");
  expect(target).toBeDefined();
  const patch = await request.patch(`${API}/api/findings/${target!.id}/status`, {
    data: { status: "in-remediation", reason: "http-smoke round-trip" },
  });
  expect(patch.status()).toBe(204);
  const after = (await (await request.get(`${API}/api/findings/${target!.id}`)).json()) as {
    status: string;
  };
  expect(after.status).toBe("in-remediation");
});
