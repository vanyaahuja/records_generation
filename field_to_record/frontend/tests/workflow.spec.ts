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
  await expect(
    page.getByRole("button", { name: "Accept all events", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("dialog")).toHaveCount(0);
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
  await expect(page.locator(".event-row")).toHaveCount(4);
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
  await page
    .getByRole("button", { name: "Close transcription", exact: true })
    .click();
  await choose(page, "Filter events", "blood_pressure");
  await expect(page.locator(".event-row")).toHaveCount(1);
  await bulk(page);
  await expect(
    page.getByRole("button", { name: "Confirm & save", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Confirm & save", exact: true })
    .click();
  await expect(page.locator(".exports")).toBeVisible();
  await page
    .getByRole("button", { name: "Record actions", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Verify audit chain", exact: true })
    .click();
  await expect(page.locator(".exports")).toContainText("Verified");
  await page
    .getByRole("button", { name: "Export record", exact: true })
    .click();
  const href = await page
    .getByRole("menuitem", { name: "FHIR-lite", exact: true })
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
    .getByRole("dialog", { name: "Edit event entry" })
    .getByRole("spinbutton")
    .fill("250");
  await expect(
    page.getByRole("button", { name: "Confirm & save", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("dialog", { name: "Edit event entry" })
    .getByRole("button", { name: "Accept event", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm & save", exact: true })
    .click();
  await expect(page.locator(".exports .mono")).toContainText("revision 2");
  await page
    .getByRole("button", { name: "Record actions", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Original extraction", exact: true })
    .click();
  await expect(page.locator(".exports pre")).toContainText("500");
  await choose(page, "Record revision", "1");
  await expect(page.locator(".exports .mono")).toContainText("revision 1");
  await expect(page.locator(".event-row").first()).toContainText("500 mg");
  await choose(page, "Record revision", "2");
  await expect(page.locator(".exports .mono")).toContainText("revision 2");
  await expect(page.locator(".event-row").first()).toContainText("250 mg");
  await page
    .getByRole("button", { name: "Export record", exact: true })
    .press("ArrowDown");
  const exportMenu = page.getByRole("menu", {
    name: "Export record",
    exact: true,
  });
  await expect(
    exportMenu.getByRole("menuitem", { name: "PDF", exact: true }),
  ).toBeFocused();
  await expect(
    exportMenu.getByRole("menuitem", { name: "PDF", exact: true }),
  ).toHaveAttribute("href", /version=2$/);
  await exportMenu
    .getByRole("menuitem", { name: "PDF", exact: true })
    .press("End");
  await expect(
    exportMenu.getByRole("menuitem", { name: "TEXT", exact: true }),
  ).toBeFocused();
  await exportMenu
    .getByRole("menuitem", { name: "TEXT", exact: true })
    .press("Escape");
  await expect(exportMenu).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Export record", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Preview note", exact: true }).click();
  await expect(page.getByTitle("Handover preview")).toBeVisible();
  await page
    .getByRole("button", { name: "Close record details", exact: true })
    .click();

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
  await expect(page.locator(".event-row")).toHaveCount(5);
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
  const primaryColor = await page
    .locator(".chart-dot")
    .first()
    .evaluate((dot) => getComputedStyle(dot).fill);
  const secondaryColor = await page
    .locator(".secondary-dot")
    .first()
    .evaluate((dot) => getComputedStyle(dot).fill);
  expect(primaryColor).not.toBe(secondaryColor);
  expect(primaryColor).toBe("rgb(13, 148, 136)");
  await page.locator(".chart-dot").first().focus();
  await expect(page.locator(".reading-tooltip")).toContainText("120/80");
  const dotBox = await page.locator(".chart-dot").first().boundingBox();
  const tipBox = await page.locator(".reading-tooltip").boundingBox();
  expect(tipBox!.y + tipBox!.height).toBeLessThanOrEqual(dotBox!.y - 8);
  await expect(page.locator(".reading-tooltip")).toHaveCSS(
    "z-index",
    "2147483647",
  );
  await expect(page.locator(".chart-dot").first()).toHaveCSS(
    "outline-style",
    "none",
  );
  expect(
    await page
      .locator(".chart-line")
      .first()
      .evaluate((node) => getComputedStyle(node).animationName),
  ).toBe("chart-draw");

  await choose(page, "Chart observation", "heart_rate");
  await expect(page.locator(".chart-reading")).toContainText("88");
  await expect(page.locator(".chart-dot")).toHaveCount(2);
  expect(
    await page
      .locator(".chart-dot")
      .first()
      .evaluate((dot) => getComputedStyle(dot).fill),
  ).not.toBe(primaryColor);
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
  await expect(page.locator(".event-row")).toHaveCount(4);
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
  await expect(page.locator(".event-row")).toHaveCount(1);
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
  await expect(page.locator(".event-row")).toHaveCount(1);
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
  await expect(page.locator(".event-row").first()).toBeVisible({
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
    .getByRole("button", { name: "Patient overview", exact: true })
    .hover();
  await expect(page.getByRole("tooltip")).toHaveText("Patient overview");
  await expect(page.getByRole("tooltip")).toHaveCSS("z-index", "2147483647");
  expect(
    await page
      .getByRole("tooltip")
      .evaluate((node) => node.parentElement?.tagName),
  ).toBe("BODY");
  await expect(page.locator("html")).toHaveCSS("scrollbar-width", "thin");
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
  await expect(page.locator(".select-popover")).toHaveCSS("box-shadow", "none");
  await expect(page.locator(".select-options")).toHaveCSS(
    "scrollbar-width",
    "none",
  );
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

test("flat event table, on-demand transcription and review without SOAP", async ({
  page,
  request,
}) => {
  await registered(page, request);
  await page.getByRole("button", { name: "Load example", exact: true }).click();
  await page
    .getByRole("button", { name: "Extract events", exact: true })
    .click();
  await expect(
    page.getByRole("table", { name: "Recorded events", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".event-row")).toHaveCount(4);
  await expect(page.locator(".event-card")).toHaveCount(0);
  await expect(page.getByText("Subjective", { exact: true })).toHaveCount(0);
  await expect(page.locator(".transcript")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Original transcription", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Original transcription",
    exact: true,
  });
  await expect(dialog).toContainText("paracetamol");
  await page
    .getByRole("button", { name: "Close transcription", exact: true })
    .press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Original transcription", exact: true }),
  ).toBeFocused();
  await choose(page, "Filter events", "observation");
  await expect(page.locator(".event-row")).toHaveCount(1);
  await expect(page.locator(".event-row")).toContainText("120/80");
  await choose(page, "Filter events", "all");
  await page
    .getByRole("button", { name: "Back to capture", exact: true })
    .click();
  await page
    .getByLabel("On-scene narrative", { exact: true })
    .fill("Crew arrived on scene.");
  await page
    .getByRole("button", { name: "Extract events", exact: true })
    .click();
  await bulk(page);
  await expect(
    page.getByRole("button", { name: "Confirm & save", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Confirm & save", exact: true })
    .click();
  await expect(page.locator(".exports")).toBeVisible();
  await page
    .getByRole("button", { name: "Export record", exact: true })
    .click();
  const href = await page
    .getByRole("menuitem", { name: "JSON", exact: true })
    .getAttribute("href");
  const exported = await (await request.get(href!)).json();
  expect(exported.record.document_format).toBe("timeline");
  expect(exported.record.events[0].source_text).toBe("Crew arrived on scene.");
  await expect(
    page.getByRole("link", { name: "SOAP", exact: true }),
  ).toHaveCount(0);
  const recordId = href!.match(/\/api\/records\/([^/]+)\//)![1];
  await page.goto(`/?record=${encodeURIComponent(recordId)}`);
  await expect(
    page.getByRole("heading", { name: "Review events", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".event-row")).toHaveCount(1);
});

test("record library scopes search and patient switches by ID, including identical names", async ({
  page,
  request,
}) => {
  const name = `Synthetic Library ${Date.now()}`;
  const a = await registered(page, request, name);
  const b = await (
    await request.post("/api/patients", {
      data: { name, age: 34, gender: "female" },
    })
  ).json();
  for (const [patient, caseId] of [
    [a, "LIBRARY-A"],
    [b, "LIBRARY-B"],
  ] as const) {
    const extraction = await (
      await request.post("/api/extract", {
        data: {
          text: "At 14:10 recorded blood pressure 120/80.",
          case_id: caseId,
          responder_id: "SYNTHETIC-TEST",
        },
      })
    ).json();
    const result = await request.post("/api/records", {
      data: {
        patient_id: patient.patient_id,
        case_id: caseId,
        responder_id: "SYNTHETIC-TEST",
        narrative: extraction.narrative,
        events: extraction.events,
        extraction_id: extraction.extraction_id,
        encounter_date: extraction.encounter_date,
        tz: extraction.tz,
        document_format: "soap",
      },
    });
    expect(result.ok()).toBeTruthy();
  }
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await nav
    .getByRole("button", { name: "Record library", exact: true })
    .click();
  await expect(page.locator(".record-list > button")).toHaveCount(1);
  await expect(page.locator(".record-list")).toContainText("LIBRARY-A");
  await expect(page.locator(".record-list")).not.toContainText("LIBRARY-B");
  await page
    .getByRole("textbox", { name: "Search records", exact: true })
    .fill("LIBRARY-B");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No matching records", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Search records", exact: true })
    .fill("");
  await expect(page.locator(".record-list > button")).toHaveCount(1);
  await choose(page, "Active patient", b.patient_id);
  await expect(
    page.getByRole("heading", { name: "Records", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".record-list > button")).toHaveCount(1);
  await expect(page.locator(".record-list")).toContainText("LIBRARY-B");
  await expect(page.locator(".record-list")).not.toContainText("LIBRARY-A");
  await page
    .getByRole("textbox", { name: "Search records", exact: true })
    .fill("LIBRARY-A");
  await expect(
    page.getByRole("heading", { name: "No matching records", exact: true }),
  ).toBeVisible();
});

test("editor dropdown layers, aligned fields, status chips, icon actions and one-click uncertainty", async ({
  page,
  request,
}) => {
  await registered(page, request);
  await page
    .getByLabel("On-scene narrative", { exact: true })
    .fill(
      "At 14:05 administered salbutamol by inhalation. At 14:10 recorded blood pressure 120/80.",
    );
  await page
    .getByRole("button", { name: "Extract events", exact: true })
    .click();
  await expect(page.locator(".event-row")).toHaveCount(2);
  await expect(
    page.locator(".event-row").first().locator(".missing-chip"),
  ).toContainText("missing dose");
  await expect(
    page.locator(".event-row").first().locator(".status-completed"),
  ).toHaveCSS("color", "rgb(24, 121, 78)");
  await expect(
    page.locator(".event-row").first().locator(".event-tools button"),
  ).toHaveCount(3);
  expect(
    await page
      .locator(".event-row")
      .first()
      .locator(".event-tools")
      .innerText(),
  ).toBe("");
  await page.getByRole("button", { name: "Edit event 1", exact: true }).click();
  const editor = page.getByRole("dialog", {
    name: "Edit event entry",
    exact: true,
  });
  await expect(page.locator(".event-editor-backdrop")).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0.3)",
  );
  expect(
    await page
      .locator(".event-editor-backdrop")
      .evaluate((node) => getComputedStyle(node).backdropFilter),
  ).toContain("blur(9px)");
  const actionBox = await page
    .getByRole("combobox", { name: "Action status", exact: true })
    .boundingBox();
  const timeBox = await page
    .getByLabel("Event 1 time", { exact: true })
    .boundingBox();
  expect(Math.abs(actionBox!.y - timeBox!.y)).toBeLessThan(2);
  await page
    .getByRole("combobox", { name: "Action status", exact: true })
    .click();
  await expect(page.locator(".select-popover")).toHaveCSS("z-index", "10000");
  await page.getByRole("option", { name: "Uncertain", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Action status", exact: true }),
  ).toContainText("Uncertain");
  await choose(page, "Action status", "reported");
  await expect(editor.locator('input[type="checkbox"]')).toHaveCSS(
    "appearance",
    "none",
  );
  await page.getByRole("button", { name: "Close editor", exact: true }).click();
  await page
    .getByRole("button", { name: "Delete event 2", exact: true })
    .click();
  await expect(page.locator(".event-row")).toHaveCount(1);
  await page
    .getByRole("button", {
      name: "Accept all including uncertainty",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Confirm & save", exact: true }),
  ).toBeEnabled();
  await expect(
    page.locator(".event-row").first().locator(".missing-chip"),
  ).toContainText("missing dose");
  await page
    .getByRole("button", { name: "Confirm & save", exact: true })
    .click();
  await expect(page.locator(".exports")).toBeVisible();
  await page
    .getByRole("button", { name: "Export record", exact: true })
    .click();
  const href = await page
    .getByRole("menuitem", { name: "JSON", exact: true })
    .getAttribute("href");
  const record = (await (await request.get(href!)).json()).record;
  expect(record.events[0].accepted_flags).toContain("missing_dose");
  expect(record.events[0].dose?.value ?? null).toBeNull();
});

test("overall dashboard totals, real chart data and animated hover indicators", async ({
  page,
  request,
}) => {
  await page.goto("/?view=overview");
  await expect(page.locator(".overview-stats .stat-card")).toHaveCount(4);
  const summary = await (
    await request.get(
      "/api/dashboard?days=30&end_date=" +
        new Date().toLocaleDateString("en-CA"),
    )
  ).json();
  for (const [index, key] of [
    "patients",
    "records",
    "events",
    "pending_events",
  ].entries()) {
    await expect(
      page.locator(".overview-stats .stat-value").nth(index),
    ).toHaveText(summary.totals[key].toLocaleString());
  }
  await expect(page.locator(".patient-context")).toHaveCount(0);
  await expect(page.locator(".overview-column")).toHaveCount(30);
  await choose(page, "Overview date range", "7");
  await expect(page.locator(".overview-column")).toHaveCount(7);
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  const before = await page
    .locator(".nav-glider")
    .evaluate((node) => getComputedStyle(node).transform);
  await nav.getByRole("button", { name: "Patients", exact: true }).hover();
  await expect
    .poll(() =>
      page
        .locator(".nav-glider")
        .evaluate((node) => getComputedStyle(node).transform),
    )
    .not.toBe(before);
  expect(
    await page
      .locator(".nav-glider")
      .evaluate((node) => getComputedStyle(node).transitionProperty),
  ).toContain("transform");
  await page
    .getByRole("combobox", { name: "Overview date range", exact: true })
    .click();
  const initial = await page
    .locator(".option-glider")
    .evaluate((node) => getComputedStyle(node).transform);
  await page.getByRole("option", { name: "Last 90 days", exact: true }).hover();
  await expect
    .poll(() =>
      page
        .locator(".option-glider")
        .evaluate((node) => getComputedStyle(node).transform),
    )
    .not.toBe(initial);
  await page.getByRole("option", { name: "Last 90 days", exact: true }).click();
  await expect(page.locator(".overview-column")).toHaveCount(90);
  await noOverflow(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await expect(
    page.getByRole("heading", { name: "Recorded activity", exact: true }),
  ).toBeVisible();
});
