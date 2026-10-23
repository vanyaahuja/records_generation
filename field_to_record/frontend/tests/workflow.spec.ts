import { test, expect } from "@playwright/test";

test("review, trace evidence, save, revise, export, verify and reopen", async ({
  page,
  request,
  baseURL,
}) => {
  const remote: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith(baseURL!)) remote.push(r.url());
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Extract events", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Extract events", exact: true })
    .click();
  await expect(page.locator(".event-card")).toHaveCount(4);
  await expect(
    page.getByRole("button", { name: "Confirm & save" }),
  ).toBeDisabled();
  await page
    .locator(".event-card")
    .first()
    .getByRole("button", { name: "Source", exact: true })
    .nth(2)
    .click();
  await expect(page.locator("mark")).toContainText("paracetamol");
  for (const card of await page.locator(".event-card").all()) {
    const flags = card.getByRole("checkbox");
    if (await flags.count()) await flags.check();
    await card
      .getByRole("button", { name: "Accept event", exact: true })
      .click();
  }
  await page.getByRole("button", { name: "Confirm & save" }).click();
  await expect(page.locator(".exports")).toBeVisible();
  await page.getByRole("button", { name: "Verify audit chain" }).click();
  await expect(page.locator(".exports")).toContainText("Verified");
  const href = await page
    .getByRole("link", { name: "FHIR-lite", exact: true })
    .getAttribute("href");
  expect((await request.get(href!)).status()).toBe(200);
  const pdf = await request.get(href!.replace("/fhir", "/pdf"));
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
  await page.getByRole("button", { name: "Preview note" }).click();
  await expect(page.locator("iframe")).toBeVisible();
  await page.locator(".event-card").first().getByRole("spinbutton").fill("250");
  await page
    .locator(".event-card")
    .first()
    .getByRole("button", { name: "Accept event", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm & save" }).click();
  await expect(page.locator(".exports .mono")).toContainText("revision 2");
  await page.getByRole("button", { name: "Original extraction" }).click();
  await expect(page.locator(".exports pre")).toContainText("500");
  await page.screenshot({
    path: "test-results/review-desktop.png",
    fullPage: true,
  });
  expect(remote).toEqual([]);
});

test("editing narrative invalidates old extraction; narrow layout fits", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 850 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Extract events", exact: true })
    .click();
  await expect(page.locator(".event-card")).toHaveCount(4);
  await page
    .getByLabel("On-scene narrative", { exact: true })
    .fill("At 14:05 performed bandaging.");
  await expect(page.locator(".event-card")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/review-mobile.png",
    fullPage: true,
  });
});

test("real synthetic audio upload is transcribed locally", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Clear note" }).click();
  await page
    .locator("input[type=file]")
    .setInputFiles("../data/audio/medication.wav");
  await expect(
    page.getByLabel("On-scene narrative", { exact: true }),
  ).toHaveValue(/fictional agent/i, { timeout: 30000 });
  await page
    .getByRole("button", { name: "Extract events", exact: true })
    .click();
  await expect(page.locator(".event-card")).toHaveCount(1);
});

test("live microphone pipeline emits provisional words and extracts on stop", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["microphone"]);
  await page.goto("/");
  await page.getByRole("button", { name: "Clear note" }).click();
  await page.getByRole("button", { name: "Start speaking" }).click();
  await expect(page.locator(".live-preview")).toBeVisible();
  await expect(page.locator(".live-preview p")).not.toContainText(
    "Waiting for the next phrase",
    { timeout: 15000 },
  );
  await page.getByRole("button", { name: "Stop & extract" }).click();
  await expect(page.locator(".live-preview")).toHaveCount(0, {
    timeout: 30000,
  });
  await expect(
    page.getByLabel("On-scene narrative", { exact: true }),
  ).toHaveValue(/fictional|intravenously/i, { timeout: 20000 });
  await expect(page.locator(".event-card").first()).toBeVisible({
    timeout: 15000,
  });
  await expect(
    page.getByRole("button", { name: "Confirm & save" }),
  ).toBeDisabled();
});
