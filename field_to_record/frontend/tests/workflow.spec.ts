import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";

async function registered(
  page: Page,
  request: APIRequestContext,
  name = "Synthetic Alex",
) {
  const result = await request.post("/api/patients", {
    data: { name, age: 34, gender: "female" },
  });
  expect(result.ok()).toBeTruthy();
  const patient = await result.json();
  await page.goto("/");
  await page
    .getByLabel("Active patient", { exact: true })
    .selectOption(patient.patient_id);
  return patient;
}
async function bulk(page: Page) {
  await page
    .getByRole("button", { name: "Accept all events", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  const flags = dialog.getByRole("checkbox");
  if (await flags.count()) {
    await expect(
      dialog.getByRole("button", { name: "Accept every event" }),
    ).toBeDisabled();
    await flags.check();
  }
  await dialog.getByRole("button", { name: "Accept every event" }).click();
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

test("capture first, patient registration, filtered bulk review, revisions and export", async ({
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
    page.getByLabel("On-scene narrative", { exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Extract events", exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: "test-results/capture-charcoal.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "New patient", exact: true }).click();
  await page
    .getByLabel("Patient name", { exact: true })
    .fill("Synthetic Alex " + Date.now());
  await page.getByLabel("Age", { exact: true }).fill("34");
  await page.getByLabel("Gender", { exact: true }).selectOption("female");
  await page
    .getByRole("button", { name: "Register patient", exact: true })
    .click();
  await expect(
    page.getByLabel("On-scene narrative", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Load example", exact: true }).click();
  await page
    .getByRole("button", { name: "Extract events", exact: true })
    .click();
  await expect(page.locator(".event-card")).toHaveCount(4);
  await expect(
    page.getByRole("button", { name: "Confirm & save", exact: true }),
  ).toBeDisabled();
  await page
    .locator(".event-card")
    .first()
    .getByRole("button", { name: "Source", exact: true })
    .nth(2)
    .click();
  await expect(page.locator("mark")).toContainText("paracetamol");
  await page
    .getByLabel("Filter events", { exact: true })
    .selectOption("blood_pressure");
  await expect(page.locator(".event-card")).toHaveCount(1);
  await bulk(page);
  await expect(
    page.getByRole("button", { name: "Confirm & save", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Confirm & save", exact: true })
    .click();
  await expect(page.locator(".exports")).toBeVisible();
  await page
    .getByRole("button", { name: "Verify audit chain", exact: true })
    .click();
  await expect(page.locator(".exports")).toContainText("Verified");
  const href = await page
    .getByRole("link", { name: "FHIR-lite", exact: true })
    .getAttribute("href");
  expect((await request.get(href!)).status()).toBe(200);
  expect(
    (await (await request.get(href!.replace("/fhir", "/pdf"))).body())
      .subarray(0, 4)
      .toString(),
  ).toBe("%PDF");
  await page.getByLabel("Filter events", { exact: true }).selectOption("all");
  await page.locator(".event-card").first().getByRole("spinbutton").fill("250");
  await expect(
    page.getByRole("button", { name: "Confirm & save", exact: true }),
  ).toBeDisabled();
  await page
    .locator(".event-card")
    .first()
    .getByRole("button", { name: "Accept event", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm & save", exact: true })
    .click();
  await expect(page.locator(".exports .mono")).toContainText("revision 2");
  await page
    .getByRole("button", { name: "Original extraction", exact: true })
    .click();
  await expect(page.locator(".exports pre")).toContainText("500");
  await noOverflow(page);
  await page.screenshot({
    path: "test-results/review-desktop.png",
    fullPage: true,
  });
  expect(remote).toEqual([]);
});

test("patient chart uses saved values, metric filters and isolated histories", async ({
  page,
  request,
}) => {
  const suffix = Math.random().toString(36).slice(2, 6);
  const a = await registered(page, request, "Synthetic Patient A " + suffix);
  const b = await (
    await request.post("/api/patients", {
      data: { name: "Synthetic Patient B " + suffix, age: 52, gender: "male" },
    })
  ).json();
  await page
    .getByLabel("On-scene narrative", { exact: true })
    .fill(
      "At 14:05 recorded blood pressure 120/80. At 14:08 recorded heart rate 96. At 14:10 recorded blood pressure 118/78. At 14:12 recorded heart rate 88. At 14:15 recorded temperature 37.4 celsius.",
    );
  await page
    .getByRole("button", { name: "Extract events", exact: true })
    .click();
  await expect(page.locator(".event-card")).toHaveCount(5);
  await bulk(page);
  await page
    .getByRole("button", { name: "Confirm & save", exact: true })
    .click();
  await expect(page.locator(".exports")).toBeVisible();
  await page
    .getByRole("button", { name: "Patient overview", exact: true })
    .click();
  await expect(page.locator(".chart-reading")).toContainText("118/78");
  await expect(page.locator(".chart-dot")).toHaveCount(4);
  await page
    .getByLabel("Chart observation", { exact: true })
    .selectOption("heart_rate");
  await expect(page.locator(".chart-reading")).toContainText("88");
  await expect(page.locator(".chart-dot")).toHaveCount(2);
  await page.locator(".chart-panel .chart-data summary").click();
  await expect(page.locator(".chart-panel .chart-data")).toContainText(
    "96 beats/min",
  );
  await page
    .getByLabel("Chart observation", { exact: true })
    .selectOption("temperature");
  await expect(page.locator(".chart-reading")).toContainText("37.4");
  await expect(page.locator(".chart-dot")).toHaveCount(1);
  await noOverflow(page);
  await page
    .getByLabel("Chart observation", { exact: true })
    .selectOption("blood_pressure");
  await page.locator(".chart-panel .chart-data summary").click();
  await page.screenshot({
    path: "test-results/patient-dashboard.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Patients", exact: true }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: new RegExp(b.name) }).click();
  await page
    .getByRole("button", { name: "Patient overview", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "No saved notes yet" }),
  ).toBeVisible();
  await expect(page.locator(".chart-dot")).toHaveCount(0);
  expect(
    await (
      await request.get("/api/patients/" + a.patient_id + "/records")
    ).json(),
  ).toHaveLength(1);
  expect(
    await (
      await request.get("/api/patients/" + b.patient_id + "/records")
    ).json(),
  ).toHaveLength(0);
});

test("mobile layout, dark mode and stale narrative invalidation", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 375, height: 850 });
  await registered(page, request);
  await page.getByRole("button", { name: "Load example", exact: true }).click();
  await page
    .getByRole("button", { name: "Extract events", exact: true })
    .click();
  await expect(page.locator(".event-card")).toHaveCount(4);
  await noOverflow(page);
  await page
    .getByRole("button", { name: "Back to capture", exact: true })
    .click();
  await page
    .getByLabel("On-scene narrative", { exact: true })
    .fill("At 14:05 performed bandaging.");
  await page
    .getByRole("button", { name: "Extract events", exact: true })
    .click();
  await expect(page.locator(".event-card")).toHaveCount(1);
  await page.getByRole("button", { name: /Switch to light/ }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.getByRole("button", { name: /Switch to dark/ }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await noOverflow(page);
  await page.screenshot({
    path: "test-results/review-mobile.png",
    fullPage: true,
  });
});

test("real audio upload is transcribed locally", async ({ page, request }) => {
  await registered(page, request);
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

test("live microphone produces text and reviewable events", async ({
  page,
  context,
  request,
}) => {
  let audioBytes = 0;
  page.on("websocket", (socket) => {
    if (socket.url().endsWith("/api/live"))
      socket.on("framesent", ({ payload }) => {
        if (typeof payload !== "string") audioBytes += payload.length;
      });
  });
  await context.grantPermissions(["microphone"]);
  await registered(page, request);
  await page
    .getByRole("button", { name: "Start speaking", exact: true })
    .click();
  await expect(page.locator(".live-preview")).toBeVisible();
  // Wait for a complete fixture's worth of actual PCM frames, independent of
  // probabilistic partial wording. Upload tests separately verify its content.
  await expect
    .poll(() => audioBytes, { timeout: 30000 })
    .toBeGreaterThanOrEqual(224000);
  await expect(page.locator(".live-preview p")).not.toHaveText(
    "Waiting for the next phrase…",
    { timeout: 15000 },
  );
  await page
    .getByRole("button", { name: "Stop & extract", exact: true })
    .click();
  await expect(page.locator(".event-card").first()).toBeVisible({
    timeout: 30000,
  });
  await expect(
    page.getByRole("button", { name: "Confirm & save", exact: true }),
  ).toBeDisabled();
});
