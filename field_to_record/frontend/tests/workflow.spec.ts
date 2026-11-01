import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";

async function choose(page: Page, label: string, value: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page
    .getByRole("listbox", { name: label, exact: true })
    .locator(`[data-value="${value}"]`)
    .click();
}

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
  await choose(page, "Active patient", patient.patient_id);
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
  await choose(page, "Gender", "female");
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
  await expect(page.locator(".soap-event-row")).toHaveCount(4);
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Patient overview", exact: true })
    .click();
  await expect(
    page
      .locator(".stat-card")
      .filter({ hasText: "To review" })
      .locator(".stat-value"),
  ).toHaveText("4");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Review events", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Confirm & save", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Source event 1", exact: true })
    .click();
  await expect(page.locator("mark")).toContainText("paracetamol");
  await choose(page, "Filter events", "blood_pressure");
  await expect(page.locator(".soap-event-row")).toHaveCount(1);
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
  await choose(page, "Filter events", "all");
  await page.getByRole("button", { name: "Edit event 1", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Edit SOAP entry" })
    .getByRole("spinbutton")
    .fill("250");
  await expect(
    page.getByRole("button", { name: "Confirm & save", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("dialog", { name: "Edit SOAP entry" })
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
  await expect(page.locator(".soap-event-row")).toHaveCount(5);
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
  await page.locator(".chart-dot").first().focus();
  await expect(page.locator(".reading-tooltip")).toContainText("120/80");
  await choose(page, "Chart observation", "heart_rate");
  await expect(page.locator(".chart-reading")).toContainText("88");
  await expect(page.locator(".chart-dot")).toHaveCount(2);
  await page.locator(".chart-panel .chart-data summary").click();
  await expect(page.locator(".chart-panel .chart-data")).toContainText(
    "96 beats/min",
  );
  await choose(page, "Chart observation", "temperature");
  await expect(page.locator(".chart-reading")).toContainText("37.4");
  await expect(page.locator(".chart-dot")).toHaveCount(1);
  await noOverflow(page);
  await choose(page, "Chart observation", "blood_pressure");
  await page.locator(".chart-panel .chart-data summary").click();
  if (
    await page
      .getByRole("button", { name: "Dismiss notification", exact: true })
      .count()
  )
    await page
      .getByRole("button", { name: "Dismiss notification", exact: true })
      .click();
  await page.screenshot({
    path: "test-results/patient-dashboard.png",
    fullPage: true,
  });
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Patients", exact: true })
    .click();

  await page.getByRole("button", { name: new RegExp(b.name) }).click();
  await page
    .getByRole("button", { name: "Switch patient", exact: true })
    .click();
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
  await expect(page.locator(".soap-event-row")).toHaveCount(4);
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
  await expect(page.locator(".soap-event-row")).toHaveCount(1);
  await page.getByRole("button", { name: /Switch to dark/ }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: /Switch to light/ }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
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
  await expect(page.locator(".soap-event-row")).toHaveCount(1);
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
  await expect(page.locator(".soap-event-row").first()).toBeVisible({
    timeout: 30000,
  });
  await expect(
    page.getByRole("button", { name: "Confirm & save", exact: true }),
  ).toBeDisabled();
});

test("custom controls, collapsible sidebar and notifications", async ({
  page,
  request,
}) => {
  await registered(page, request);
  await expect(page.locator("select")).toHaveCount(0);
  const expand = page.getByRole("button", {
    name: "Expand sidebar",
    exact: true,
  });
  await expand.click();
  await expect(
    page.getByRole("button", { name: "Collapse sidebar", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await page
    .getByRole("button", { name: "Collapse sidebar", exact: true })
    .click();
  await expect(expand).toBeVisible();
  await page
    .getByRole("button", { name: "Notifications", exact: true })
    .click();
  await expect(page.getByLabel("Notification history")).toContainText(
    "caught up",
  );
  await page
    .getByRole("button", { name: "Notifications", exact: true })
    .press("Escape");
  await expect(page.getByLabel("Notification history")).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Active patient", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Search Active patient", exact: true })
    .fill("No such person");
  await expect(
    page.getByRole("listbox", { name: "Active patient", exact: true }),
  ).toContainText("No results");
  await page
    .getByRole("textbox", { name: "Search Active patient", exact: true })
    .press("Escape");
  await expect(
    page.getByRole("combobox", { name: "Active patient", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Load example", exact: true }).click();
  await page
    .getByRole("button", { name: "Extract events", exact: true })
    .click();
  await expect(page.locator(".toast")).toBeVisible();
  await page
    .getByRole("button", { name: "Dismiss notification", exact: true })
    .click();
  await expect(page.locator(".toast")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Notifications", exact: true })
    .click();
  await expect(page.getByLabel("Notification history")).toContainText(
    "Extraction complete",
  );
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.getByLabel("Notification history")).toContainText(
    "caught up",
  );
  await page
    .getByRole("button", { name: "Notifications", exact: true })
    .click();
  await noOverflow(page);
  expect(
    await page
      .locator(".panel")
      .first()
      .evaluate((node) => getComputedStyle(node).borderTopWidth),
  ).toBe("0px");
  expect(
    await page.locator('svg[data-icon-set="solar"]').count(),
  ).toBeGreaterThan(5);
  await page.route("**/api/extract", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Extraction unavailable" }),
    }),
  );
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Capture note", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Extract events", exact: true })
    .click();
  await expect(page.locator(".toast.error")).toContainText(
    "Extraction unavailable",
  );
});

test("SOAP sections are tabular and unassigned statements require categorization", async ({
  page,
  request,
}) => {
  await registered(page, request);
  await page.getByRole("button", { name: "Load example", exact: true }).click();
  await page
    .getByRole("button", { name: "Extract events", exact: true })
    .click();
  await expect(
    page.getByRole("table", { name: "Subjective entries" }),
  ).toContainText("Not documented");
  await expect(
    page.getByRole("table", { name: "Assessment entries" }),
  ).toContainText("Not documented");
  await expect(
    page
      .getByRole("table", { name: "Objective entries" })
      .locator(".soap-event-row"),
  ).toHaveCount(1);
  await expect(
    page
      .getByRole("table", { name: "Plan entries" })
      .locator(".soap-event-row"),
  ).toHaveCount(3);
  await expect(page.locator(".event-card")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Back to capture", exact: true })
    .click();
  await page
    .getByLabel("On-scene narrative", { exact: true })
    .fill("Crew arrived on scene.");
  await page
    .getByRole("button", { name: "Extract events", exact: true })
    .click();
  await expect(
    page.getByRole("table", { name: "Unassigned entries" }),
  ).toBeVisible();
  await choose(page, "SOAP section for event 1", "O");
  await bulk(page);
  await expect(
    page.getByRole("button", { name: "Confirm & save", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Confirm & save", exact: true })
    .click();
  await expect(page.locator(".exports")).toBeVisible();
  const soapLink = page.getByRole("link", { name: "SOAP", exact: true });
  const href = await soapLink.getAttribute("href");
  const exported = await (await request.get(href!)).json();
  expect(
    exported.sections.find((s: { code: string }) => s.code === "O").rows[0]
      .source_text,
  ).toBe("Crew arrived on scene.");
  const recordId = href!.match(/\/api\/records\/([^/]+)\//)![1];
  await page.goto(`/?record=${encodeURIComponent(recordId)}`);
  await expect(
    page.getByRole("heading", { name: "SOAP review", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".soap-event-row")).toHaveCount(1);
  await expect(page.locator(".event-card")).toHaveCount(0);
});
