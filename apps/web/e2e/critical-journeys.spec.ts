import { expect, test, type Page } from "@playwright/test";

/** Switch the simulated RBAC role via the profile menu. */
async function switchRole(page: Page, roleLabel: string) {
  await page.getByRole("button", { name: "User profile and role" }).click();
  await page.getByRole("menuitem", { name: roleLabel }).click();
}

test.describe("critical user journeys", () => {
  test("1. open an application and inspect its latest pipeline", async ({ page }) => {
    await page.goto("/applications");
    await page.getByRole("heading", { name: "Payments API" }).click();
    await expect(page.getByRole("heading", { name: /Payments API/ })).toBeVisible();
    await page.getByRole("link", { name: /run-1482/ }).first().click();
    await expect(page.getByRole("heading", { name: /run-1482/ })).toBeVisible();
  });

  test("2. investigate a failed security gate and 3. review remediation", async ({ page }) => {
    await page.goto("/pipelines/run-2210");
    await expect(page.getByText("Blocked", { exact: true }).first()).toBeVisible();
    // Select the blocking stage in the graph.
    await page.getByText("Image vulnerability scan").first().click();
    await expect(page.getByText("Failure reason")).toBeVisible();
    await expect(page.getByText("Remediation recommendation")).toBeVisible();
    await expect(page.getByText(/node:20.19-alpine3.21/).first()).toBeVisible();
  });

  test("4. approve a staging deployment as release approver", async ({ page }) => {
    await page.goto("/pipelines/run-1482");
    await switchRole(page, "Release Approver");
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await page.getByLabel("Justification (required)").fill("Canary strategy approved; gates green.");
    await page.getByRole("button", { name: "Confirm approval" }).click();
    await expect(page.getByText("Deployment approved")).toBeVisible();
  });

  test("5. developers cannot approve production deployments (RBAC)", async ({ page }) => {
    await page.goto("/pipelines/run-1482");
    await switchRole(page, "Developer");
    const approve = page.getByRole("button", { name: "Approve", exact: true });
    if (await approve.count()) {
      await expect(approve).toBeDisabled();
    }
  });

  test("6. review a Terraform plan", async ({ page }) => {
    await page.goto("/infrastructure?plan=plan-identity-0862");
    await expect(page.getByText("Policy violations")).toBeVisible();
    await expect(page.getByText(/CKV_AZURE_109/).first()).toBeVisible();
    await expect(page.getByText("Previous vs proposed infrastructure")).toBeVisible();
  });

  test("7. accept a documented risk as security engineer", async ({ page }) => {
    // Switch roles first (the dialog overlay blocks the profile menu), then
    // open the finding via client-side navigation — a full reload would reset
    // the in-memory session role.
    await page.goto("/security");
    await switchRole(page, "Security Engineer");
    await page.getByText("Outdated dependency: axios 1.6.2 (SSRF bypass)").click();
    await page.getByRole("button", { name: "Accept risk" }).click();
    await page.getByLabel("Business justification").fill("Mitigated by mesh egress allow-list; upgrade scheduled.");
    await page.getByLabel("Expires").fill("2026-09-30");
    await page.getByRole("button", { name: "Accept risk" }).last().click();
    await expect(page.getByText("Finding updated")).toBeVisible();
  });

  test("8. generate a proposed DevSecOps pipeline", async ({ page }) => {
    await page.goto("/generator");
    await page.getByRole("button", { name: "Generate", exact: true }).click();
    await expect(page.getByText(/Generated secure delivery plan/)).toBeVisible({ timeout: 15_000 });
    await page.getByRole("tab", { name: /Pipeline \(/ }).click();
    await expect(page.getByText("Secret scanning")).toBeVisible();
  });

  test("9. review a compliance control", async ({ page }) => {
    await page.goto("/compliance");
    await page.getByRole("button", { name: /PCI DSS/ }).click();
    await expect(page.getByText("Patch critical vulnerabilities within one month")).toBeVisible();
  });

  test("10. roll back a failed deployment as release approver", async ({ page }) => {
    await page.goto("/deployments");
    await switchRole(page, "Release Approver");
    await page.getByRole("button", { name: /Rollback prod/ }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Roll back" }).click();
    await expect(page.getByText("Rollback executed")).toBeVisible();
  });

  test("all primary navigation routes render", async ({ page }) => {
    const routes = [
      "/",
      "/applications",
      "/pipelines",
      "/security",
      "/infrastructure",
      "/deployments",
      "/compliance",
      "/generator",
      "/integrations",
      "/audit",
      "/settings",
    ];
    for (const route of routes) {
      await page.goto(route);
      await expect(page.getByRole("heading").first()).toBeVisible();
    }
  });
});
