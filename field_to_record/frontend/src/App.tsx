import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  startTransition,
} from "react";
import EventCard from "./EventCard";
import { api } from "./api";
import { LiveAudio } from "./live";
import { reducer, initial, sample, type Event, type Extraction } from "./state";
import type { SaveRecordRequest, Record as ClinicalRecord } from "./generated";

type Saved = {
  record_id: string;
  version: number;
  record: ClinicalRecord;
  revisions: { version: number; actor: string; created_at: string }[];
};
type History = {
  record_id: string;
  version: number;
  case_id: string;
  record_status: string;
  event_count: number;
};

export default function App() {
  const [state, dispatch] = useReducer(reducer, initial);
  const [caseId, setCaseId] = useState("DEMO-001"),
    [responder, setResponder] = useState("DEMO-RESPONDER");
  const [encounterDate, setEncounterDate] = useState(
      new Date().toLocaleDateString("en-CA"),
    ),
    [tz, setTz] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [notice, setNotice] = useState(
    "Use synthetic notes only. Review every event before confirming.",
  );
  const [busy, setBusy] = useState(false),
    [live, setLive] = useState(false),
    [partial, setPartial] = useState(""),
    [liveEvents, setLiveEvents] = useState<Event[]>([]);
  const [speechReady, setSpeechReady] = useState(false),
    [apiReady, setApiReady] = useState(false),
    [network, setNetwork] = useState(navigator.onLine);
  const [latency, setLatency] = useState<number | null>(null),
    [asrLatency, setAsrLatency] = useState<number | null>(null);
  const [history, setHistory] = useState<History[]>([]),
    [query, setQuery] = useState(""),
    [preview, setPreview] = useState(""),
    [audit, setAudit] = useState(""),
    [original, setOriginal] = useState(""),
    [revisions, setRevisions] = useState<Saved["revisions"]>([]);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("theme");
      if (saved === "light" || saved === "dark") return saved;
      if (window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
    }
    return "light";
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));
  const speech = useRef<LiveAudio | null>(null),
    noteRef = useRef(state.narrative),
    eventsRef = useRef(state.events);
  noteRef.current = state.narrative;
  eventsRef.current = state.events;
  useEffect(() => {
    let mounted = true;
    const update = () => setNetwork(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    const health = async () => {
      const [backend, asr] = await Promise.allSettled([
        api<{ ready: boolean }>("/readyz"),
        api<{ ready: boolean }>("/api/speech/status"),
      ]);
      if (!mounted) return;
      setApiReady(backend.status === "fulfilled" && backend.value.ready);
      setSpeechReady(asr.status === "fulfilled" && asr.value.ready);
    };
    void health();
    const timer = setInterval(health, 10000);
    return () => {
      mounted = false;
      clearInterval(timer);
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      speech.current?.close();
    };
  }, []);
  const loadHistory = useCallback(async () => {
    try {
      setHistory(
        await api<History[]>("/api/records?q=" + encodeURIComponent(query)),
      );
    } catch (e) {
      setNotice((e as Error).message);
    }
  }, [query]);
  async function extract(text = state.narrative) {
    setBusy(true);
    setPreview("");
    setOriginal("");
    setAudit("");
    try {
      const start = performance.now();
      const result = await api<Extraction>("/api/extract", {
        method: "POST",
        body: JSON.stringify({
          text,
          case_id: caseId,
          responder_id: responder,
          encounter_date: encounterDate || null,
          tz,
        }),
      });
      dispatch({ type: "extracted", value: result });
      setLatency(performance.now() - start);
      setNotice(
        "Extraction complete. Select Source to inspect evidence, resolve flags, and accept each event.",
      );
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function changeNarrative(value: string) {
    dispatch({ type: "narrative", value });
    setPreview("");
    setAudit("");
    setOriginal("");
  }
  const update = useCallback((index: number, patch: Partial<Event>) => {
    const events = eventsRef.current.map((e, i) =>
      i === index ? { ...e, ...patch } : e,
    );
    // Missing flags reflect current values; semantic warnings stay visible for acknowledgment.
    const e = events[index];
    if (patch.status)
      e.action_status = {
        reported: "completed",
        negated: "not_done",
        uncertain: "unclear",
        needs_review: "unclear",
      }[patch.status] as Event["action_status"];
    e.flags = e.flags.filter((f) => !f.startsWith("missing_"));
    if (e.event_type === "medication_administration") {
      if (!e.medication) e.flags.push("missing_medication");
      if (e.dose?.value == null || !e.dose?.unit) e.flags.push("missing_dose");
      if (!e.route) e.flags.push("missing_route");
    }
    if (!e.event_time) e.flags.push("missing_time");
    if (e.event_type === "observation") {
      const obs = e.observation || {};
      if (!obs.type) e.flags.push("missing_observation_type");
      if (
        (obs.type === "blood_pressure"
          ? ["systolic", "diastolic"]
          : ["value"]
        ).some((key) => obs[key] == null)
      )
        e.flags.push("missing_observation_value");
      if (!obs.unit) e.flags.push("missing_observation_unit");
    }
    if (
      e.event_type === "unclassified" &&
      !e.flags.includes("unclassified_statement")
    )
      e.flags.push("unclassified_statement");
    eventsRef.current = events;
    dispatch({ type: "events", value: events });
  }, []);
  const remove = useCallback((index: number) => {
    const events = eventsRef.current.filter((_, i) => i !== index);
    eventsRef.current = events;
    dispatch({ type: "events", value: events });
  }, []);
  const select = useCallback((value: [number, number]) => {
    dispatch({ type: "select", value });
    document
      .getElementById("evidence-transcript")
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, []);
  function addEvent() {
    const event: Event = {
      event_id: crypto.randomUUID(),
      event_type: "unclassified",
      description: "Manual event",
      medication: null,
      dose: null,
      route: null,
      observation: null,
      event_time: null,
      time_source: "unknown",
      action_status: "unclear",
      status: "needs_review",
      source_text: state.narrative,
      source_offset: 0,
      fields: {},
      flags: ["manual_entry", "missing_time", "unclassified_statement"],
      accepted_flags: [],
      manual: true,
      review_status: "needs_human_confirmation",
    };
    dispatch({ type: "events", value: [...state.events, event] });
  }
  async function save(reviewed: boolean) {
    if (!state.extraction) return;
    setBusy(true);
    try {
      const body: SaveRecordRequest = {
        case_id: caseId,
        responder_id: responder,
        narrative: state.narrative,
        events: state.events,
        extraction_id: state.extraction.extraction_id,
        record_status: reviewed ? "reviewed" : "pending_review",
        reviewer_id: responder,
        expected_version: state.recordId ? state.version : null,
        encounter_date: encounterDate || null,
        tz,
      };
      const result = await api<{ record_id: string; version: number }>(
        "/api/records" + (state.recordId ? "/" + state.recordId : ""),
        { method: state.recordId ? "PUT" : "POST", body: JSON.stringify(body) },
      );
      dispatch({
        type: "saved",
        id: result.record_id,
        version: result.version,
      });
      setPreview("");
      setAudit("");
      const bundle = await api<Saved>("/api/records/" + result.record_id);
      setRevisions(bundle.revisions);
      setNotice(
        `Saved locally · revision ${result.version} · ${reviewed ? "reviewed" : "draft"}`,
      );
      void loadHistory();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function openRecord(id: string, version?: number) {
    setBusy(true);
    try {
      const r = await api<Saved>(
        "/api/records/" + id + (version ? "?version=" + version : ""),
      );
      const record = r.record;
      setCaseId(record.case_id);
      setResponder(record.responder_id);
      setEncounterDate(record.encounter_date || "");
      setTz(record.tz || "Asia/Kolkata");
      dispatch({
        type: "open",
        value: {
          narrative: record.narrative,
          events: record.events as Event[],
          extraction: {
            extraction_id: record.extraction_id!,
            narrative: record.narrative,
            events: record.events as Event[],
            recorded_at: record.recorded_at,
            timings_ms: { extract: 0 },
          },
          recordId: id,
          version: r.version,
          selected: null,
        },
      });
      setRevisions(r.revisions);
      setPreview("");
      setAudit("");
      setOriginal("");
      setNotice(
        "Opened revision " +
          r.version +
          ". Older revisions cannot overwrite newer changes.",
      );
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function startLive() {
    const base = state.narrative.trim();
    let committed = "";
    setLive(true);
    setPartial("");
    setLiveEvents([]);
    setNotice(
      "Connecting to local speech. Speak clearly; provisional words can change.",
    );
    speech.current = new LiveAudio(
      (message) => {
        if (message.type === "ready")
          setNotice("Listening locally. Pause briefly between events.");
        if (message.type === "partial" || message.type === "final") {
          if (message.type === "final") {
            committed = message.transcript || committed;
            changeNarrative([base, committed].filter(Boolean).join("\n"));
          }
          startTransition(() => {
            setPartial(message.type === "partial" ? message.text || "" : "");
            setLiveEvents((message.events || []) as Event[]);
            setAsrLatency(message.inference_ms ?? null);
          });
        }
        if (message.type === "complete") {
          setLive(false);
          setPartial("");
          const text = [base, message.transcript || committed]
            .filter(Boolean)
            .join("\n");
          changeNarrative(text);
          void extract(text);
        }
        if (message.type === "backpressure")
          setNotice(
            "Speech worker busy. Audio is buffered; provisional updates may pause.",
          );
      },
      (message) => {
        setLive(false);
        setPartial("");
        setNotice(message);
      },
    );
    try {
      await speech.current.start();
    } catch (e) {
      setLive(false);
      setNotice((e as Error).message);
    }
  }
  async function transcribe(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const data = new FormData();
      data.append("file", file);
      const r = await api<{ text: string; inference_ms: number }>(
        "/api/transcribe",
        { method: "POST", body: data },
      );
      changeNarrative(
        [state.narrative.trim(), r.text].filter(Boolean).join("\n"),
      );
      setAsrLatency(r.inference_ms);
      setNotice("Transcript appended. Review the words, then extract events.");
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const allReviewed =
    !!state.events.length &&
    state.events.every(
      (e) =>
        e.review_status !== "needs_human_confirmation" &&
        e.flags.every((f) => e.accepted_flags.includes(f)),
    );
  const reviewedCount = state.events.filter(
    (e) => e.review_status !== "needs_human_confirmation",
  ).length;
  const span = state.selected;
  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>
      <header className="topbar">
        <a className="brand" href="/">
          <div className="brand-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          </div>
          <span>Field to Record</span>
          <span className="brand-badge">Clinical</span>
        </a>
        <div className="top-actions">
          <div className="status-badge">
            <span className={`status-dot ${apiReady ? "good" : ""}`} />
            <span>{apiReady ? "Local API ready" : "Connecting..."}</span>
          </div>
          <div className="status-badge">
            <span className={`status-dot ${network ? "good" : ""}`} />
            <span>{network ? "Network available" : "Offline"}</span>
          </div>
          <button
            type="button"
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
              </svg>
            )}
          </button>
        </div>
      </header>
      <main id="workspace">
        <div className="stats-row">
          <div className="stat-card">
            <span className="stat-label">Typed request</span>
            <div className="stat-value">
              {latency === null ? "—" : Math.round(latency)}
              <span className="stat-unit"> ms</span>
            </div>
          </div>
          <div className="stat-card">
            <span className="stat-label">Last ASR inference</span>
            <div className="stat-value">
              {asrLatency === null ? "—" : Math.round(asrLatency)}
              <span className="stat-unit"> ms</span>
            </div>
          </div>
          <div className="stat-card">
            <span className="stat-label">Events accepted</span>
            <div className="stat-value">
              {reviewedCount}
              <span className="stat-unit"> / {state.events.length}</span>
            </div>
          </div>
        </div>
        <div className="workspace-grid">
          <section className="capture-column">
            <div className="panel">
              <div className="section-heading">
                <div>
                  <span className="step">01</span>
                  <h2>Capture the note</h2>
                </div>
                <span className="tag">SYNTHETIC DATA ONLY</span>
              </div>
              <fieldset disabled={live || busy}>
                <div className="form-grid">
                  <label>
                    Case ID
                    <input
                      value={caseId}
                      onChange={(e) => setCaseId(e.target.value)}
                    />
                  </label>
                  <label>
                    Responder / reviewer
                    <input
                      value={responder}
                      onChange={(e) => setResponder(e.target.value)}
                    />
                  </label>
                  <label>
                    Encounter date
                    <input
                      type="date"
                      value={encounterDate}
                      onChange={(e) => setEncounterDate(e.target.value)}
                    />
                  </label>
                  <label>
                    Time zone
                    <input value={tz} onChange={(e) => setTz(e.target.value)} />
                  </label>
                </div>
              </fieldset>
              <div className={`recorder ${live ? "listening" : ""}`}>
                <div>
                  <span className="recorder-light" />
                  <strong>
                    {live ? "Listening on this device" : "Live local dictation"}
                  </strong>
                  <p>
                    {live
                      ? "Words and events appear as you speak"
                      : speechReady
                        ? "Speech engine warmed and ready"
                        : "Speech warms on first connection"}
                  </p>
                </div>
                <button
                  disabled={busy}
                  className={live ? "record-stop" : ""}
                  onClick={() =>
                    live ? void speech.current?.stop() : void startLive()
                  }
                >
                  {live ? "Stop & extract" : "Start speaking"}
                </button>
              </div>
              <label htmlFor="narrative">
                On-scene narrative
                <textarea
                  id="narrative"
                  aria-label="On-scene narrative"
                  rows={7}
                  disabled={live || busy}
                  value={state.narrative}
                  onChange={(e) => changeNarrative(e.target.value)}
                  placeholder="Type a synthetic note, or start speaking…"
                />
              </label>
              {live ? (
                <div className="live-preview" aria-live="polite">
                  <span>PROVISIONAL · MAY CHANGE</span>
                  <p>{partial || "Waiting for the next phrase…"}</p>
                  {liveEvents.length ? (
                    <div className="live-chips">
                      {liveEvents.map((e, i) => (
                        <span key={i}>
                          {e.medication || e.description}
                          {e.dose?.value != null
                            ? ` · ${e.dose.value} ${e.dose.unit}`
                            : ""}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="capture-actions">
                <button
                  className="link"
                  disabled={live || busy}
                  onClick={() => changeNarrative(sample)}
                >
                  Load example
                </button>
                <button
                  className="link"
                  disabled={live || busy}
                  onClick={() => changeNarrative("")}
                >
                  Clear note
                </button>
                <label className="upload">
                  Upload audio
                  <input
                    type="file"
                    accept="audio/*"
                    disabled={live || busy}
                    onChange={(e) => {
                      void transcribe(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
                <button
                  disabled={live || busy || !state.narrative.trim()}
                  onClick={() => void extract()}
                >
                  {busy ? "Working…" : "Extract events"}
                </button>
              </div>
              <p className="help">
                No cloud speech service. Names, numbers, units and times require
                review.
              </p>
            </div>
            <div className="panel transcript-panel" id="evidence-transcript">
              <div className="section-heading">
                <div>
                  <span className="step">02</span>
                  <h2>Inspect the evidence</h2>
                </div>
              </div>
              <p className="help">
                Select Source on any extracted field to highlight its original
                words.
              </p>
              <div className="transcript">
                {span ? (
                  <>
                    {Array.from(state.narrative).slice(0, span[0]).join("")}
                    <mark>
                      {Array.from(state.narrative)
                        .slice(span[0], span[1])
                        .join("")}
                    </mark>
                    {Array.from(state.narrative).slice(span[1]).join("")}
                  </>
                ) : (
                  state.narrative || "Your source transcript will appear here."
                )}
              </div>
            </div>
            <div className="panel history-panel">
              <div className="section-heading">
                <div>
                  <span className="step">04</span>
                  <h2>Local records</h2>
                </div>
                <button className="link" onClick={() => void loadHistory()}>
                  Refresh
                </button>
              </div>
              <div className="search">
                <input
                  aria-label="Search local records"
                  placeholder="Case, responder, or record ID"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <button
                  className="secondary"
                  onClick={() => void loadHistory()}
                >
                  Search
                </button>
              </div>
              {history.map((r) => (
                <button
                  className="history-row"
                  key={r.record_id}
                  disabled={busy || live}
                  onClick={() => void openRecord(r.record_id)}
                >
                  <strong>{r.case_id}</strong>
                  <span>
                    {r.event_count} events · revision {r.version} ·{" "}
                    {r.record_status.replace("_", " ")}
                  </span>
                </button>
              ))}
            </div>
          </section>
          <section className="review-column">
            <div className="panel review-panel">
              <div className="section-heading">
                <div>
                  <span className="step">03</span>
                  <h2>Review & confirm</h2>
                </div>
                <span className="count">{state.events.length} events</span>
              </div>
              {!state.extraction ? (
                <div className="empty-state">
                  <svg
                    width="52"
                    height="52"
                    viewBox="0 0 48 48"
                    fill="none"
                    aria-hidden="true"
                  >
                    <rect
                      x="10"
                      y="5"
                      width="28"
                      height="38"
                      rx="5"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                    <path
                      d="M17 16h14M17 24h14M17 32h8"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                  </svg>
                  <h3>A clear record starts here</h3>
                  <p>
                    Capture a note to see medications, procedures and
                    observations with their evidence.
                  </p>
                </div>
              ) : (
                <>
                  <div className="review-progress">
                    <span
                      style={{
                        width: `${state.events.length ? (reviewedCount / state.events.length) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  {state.events.map((event, index) => (
                    <EventCard
                      key={event.event_id}
                      event={event}
                      index={index}
                      update={update}
                      remove={remove}
                      select={select}
                    />
                  ))}
                  <button
                    className="secondary full-width"
                    onClick={addEvent}
                    disabled={busy || live}
                  >
                    + Add a missed event
                  </button>
                  <div className="save-bar">
                    <p>
                      {allReviewed
                        ? "Every event is accepted. Ready to confirm."
                        : "Accept each event and acknowledge its unresolved flags."}
                    </p>
                    <div>
                      <button
                        className="secondary"
                        disabled={busy || live}
                        onClick={() => void save(false)}
                      >
                        Save draft
                      </button>
                      <button
                        disabled={
                          busy || live || !allReviewed || !responder.trim()
                        }
                        onClick={() => void save(true)}
                      >
                        Confirm & save
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
            {state.recordId ? (
              <div className="panel exports">
                <h2>Record & revision history</h2>
                <p className="mono">
                  {state.recordId} · revision {state.version}
                </p>
                <div className="export-links">
                  {["json", "fhir", "pdf", "text"].map((format) => (
                    <a
                      key={format}
                      href={`/api/records/${state.recordId}/${format}?version=${state.version}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {format === "fhir" ? "FHIR-lite" : format.toUpperCase()}
                    </a>
                  ))}
                </div>
                <div className="export-links">
                  <button
                    className="link"
                    onClick={async () => {
                      try {
                        setPreview(
                          await (
                            await fetch(
                              `/api/records/${state.recordId}/html?version=${state.version}`,
                            )
                          ).text(),
                        );
                      } catch (e) {
                        setNotice((e as Error).message);
                      }
                    }}
                  >
                    Preview note
                  </button>
                  <button
                    className="link"
                    onClick={async () => {
                      try {
                        const r = await api<{
                          valid: boolean;
                          entries_verified: number;
                        }>("/api/audit/verify");
                        setAudit(
                          `${r.valid ? "Verified" : "FAILED"} · ${r.entries_verified} entries checked`,
                        );
                      } catch (e) {
                        setNotice((e as Error).message);
                      }
                    }}
                  >
                    Verify audit chain
                  </button>
                  <button
                    className="link"
                    onClick={async () => {
                      try {
                        setOriginal(
                          JSON.stringify(
                            await api(
                              `/api/records/${state.recordId}/original`,
                            ),
                            null,
                            2,
                          ),
                        );
                      } catch (e) {
                        setNotice((e as Error).message);
                      }
                    }}
                  >
                    Original extraction
                  </button>
                </div>
                {audit ? <p role="status">{audit}</p> : null}
                {preview ? (
                  <iframe
                    title="Generated handover note"
                    sandbox=""
                    srcDoc={preview}
                  />
                ) : null}
                {original ? (
                  <details open>
                    <summary>Original immutable output</summary>
                    <pre>{original}</pre>
                  </details>
                ) : null}
                <div className="revision-list">
                  {revisions.map((r) => (
                    <button
                      className="link"
                      key={r.version}
                      onClick={() => void openRecord(state.recordId, r.version)}
                    >
                      Revision {r.version} · {r.actor}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        </div>
        <footer>
          Hackathon prototype · Not for clinical use · FHIR-lite is not a
          conformance claim · No treatment recommendations
        </footer>
      </main>
    </div>
  );
}
