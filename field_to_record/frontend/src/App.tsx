import {
  Select,
  Notifications,
  useNotifications,
  FloatingTip,
} from "./Controls";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  startTransition,
  useMemo,
} from "react";
import {
  Icon,
  PatientDirectory,
  PatientDashboard,
  metrics,
  type PatientProfile,
  type PatientRecord,
} from "./Workspace";
import type { PatientCreate } from "./generated";

import EventTable from "./EventTable";
import RecordMenu from "./RecordMenu";
import Overview from "./Overview";
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
  patient?: PatientProfile | null;
};

export default function App() {
  const [page, setPage] = useState(() =>
    ["overview", "dashboard"].includes(
      new URLSearchParams(window.location.search).get("view") || "",
    )
      ? new URLSearchParams(window.location.search).get("view")!
      : "capture",
  );
  const requestedPatient = useRef(
    new URLSearchParams(window.location.search).get("patient"),
  );
  const requestedRecord = useRef(
    new URLSearchParams(window.location.search).get("record"),
  );
  useEffect(() => {
    const id = requestedRecord.current;
    requestedRecord.current = null;
    if (id) void openRecord(id);
  }, []);
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [patient, setPatient] = useState<PatientProfile | null>(null);
  const [patientRecords, setPatientRecords] = useState<PatientRecord[]>([]);
  const [filter, setFilter] = useState("all");
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page]);
  const [state, dispatch] = useReducer(reducer, initial);
  const [caseId, setCaseId] = useState("DEMO-001"),
    [responder, setResponder] = useState("DEMO-RESPONDER");
  const [encounterDate, setEncounterDate] = useState(
      new Date().toLocaleDateString("en-CA"),
    ),
    [tz, setTz] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const notifications = useNotifications();
  const setNotice = notifications.notify;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const transcriptOrigin = useRef<HTMLElement | null>(null);
  const showTranscription = useCallback(() => {
    transcriptOrigin.current = document.activeElement as HTMLElement;
    setTranscriptOpen(true);
  }, []);
  useEffect(() => {
    if (!transcriptOpen) return;
    return () => {
      if (transcriptOrigin.current?.isConnected)
        transcriptOrigin.current.focus({ preventScroll: true });
    };
  }, [transcriptOpen]);

  const [navTip, setNavTip] = useState<{
    anchor: HTMLElement;
    label: string;
  } | null>(null);
  const [pendingPatient, setPendingPatient] = useState<PatientProfile | null>(
    null,
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
    [revisions, setRevisions] = useState<Saved["revisions"]>([]);
  const historyRequest = useRef<AbortController | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("ftr-clean-theme");
      if (saved === "light" || saved === "dark") return saved;
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
    localStorage.setItem("ftr-clean-theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));
  const speech = useRef<LiveAudio | null>(null),
    noteRef = useRef(state.narrative),
    eventsRef = useRef(state.events);
  noteRef.current = state.narrative;
  eventsRef.current = state.events;
  useEffect(() => {
    const controller = new AbortController();
    api<PatientProfile[]>("/api/patients", { signal: controller.signal })
      .then((profiles) => {
        setPatients(profiles);
        if (requestedPatient.current) {
          const match = profiles.find(
            (p) => p.patient_id === requestedPatient.current,
          );
          if (match) setPatient(match);
          requestedPatient.current = null;
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setNotice(e.message);
      });
    return () => controller.abort();
  }, [page]);
  useEffect(() => {
    setPatientRecords([]);
    if (!patient) return;
    const controller = new AbortController();
    api<PatientRecord[]>(`/api/patients/${patient.patient_id}/records`, {
      signal: controller.signal,
    })
      .then(setPatientRecords)
      .catch((e) => {
        if (!controller.signal.aborted) setNotice(e.message);
      });
    return () => controller.abort();
  }, [patient, state.version]);
  function choosePatient(next: PatientProfile) {
    if (busy || live) return;
    if (
      patient?.patient_id !== next.patient_id &&
      (patient || state.recordId) &&
      state.narrative.trim()
    ) {
      setPendingPatient(next);
      return;
    }
    setPatient(next);
    setPage((current) =>
      ["records", "dashboard"].includes(current) ? current : "capture",
    );
    setFilter("all");
  }
  async function registerPatient(body: PatientCreate) {
    const created = await api<PatientProfile>("/api/patients", {
      method: "POST",
      body: JSON.stringify(body),
    });
    setPatients((previous) => [created, ...previous]);
    choosePatient(created);
    setNotice("Patient added.");
  }
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
    historyRequest.current?.abort();
    const controller = new AbortController();
    historyRequest.current = controller;
    setHistory([]);
    setHistoryLoading(true);
    const params = new URLSearchParams({ q: query, limit: "100" });
    if (patient) params.set("patient_id", patient.patient_id);
    try {
      const rows = await api<History[]>("/api/records?" + params, {
        signal: controller.signal,
      });
      if (!controller.signal.aborted) setHistory(rows);
    } catch (e) {
      if (!controller.signal.aborted) setNotice((e as Error).message);
    } finally {
      if (!controller.signal.aborted) setHistoryLoading(false);
    }
  }, [query, patient?.patient_id]);
  useEffect(() => {
    if (page === "records") void loadHistory();
    return () => historyRequest.current?.abort();
  }, [page, loadHistory]);
  const visibleHistory = patient
    ? history.filter(
        (record) => record.patient?.patient_id === patient.patient_id,
      )
    : history;
  async function extract(text = state.narrative) {
    setBusy(true);

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
      setPage("review");
      setFilter("all");
      setLatency(performance.now() - start);
      setNotice("Extraction complete");
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function changeNarrative(value: string) {
    dispatch({ type: "narrative", value });
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
  const select = useCallback(
    (value: [number, number]) => {
      dispatch({ type: "select", value });

      showTranscription();
    },
    [showTranscription],
  );
  function addEvent() {
    const event: Event = {
      soap_section: null,
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
    if (!state.extraction || !patient) return;
    setBusy(true);
    try {
      const body: SaveRecordRequest = {
        document_format: "timeline",
        patient_id: patient.patient_id,
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
      setPatient(record.patient || null);
      setPage("review");
      setFilter("all");
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
    setNotice("Connecting microphone…");
    speech.current = new LiveAudio(
      (message) => {
        if (message.type === "ready") setNotice("Listening");
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
      setNotice("Audio transcribed.");
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

  const visibleEvents = useMemo(
    () =>
      state.events
        .map((event, index) => ({ event, index }))
        .filter(
          ({ event }) =>
            filter === "all" ||
            filter === event.event_type ||
            filter === event.observation?.type ||
            (filter === "needs_review" &&
              event.review_status === "needs_human_confirmation"),
        ),
    [state.events, filter],
  );
  function acceptAll() {
    const accepted = state.events.map((e) => ({
      ...e,
      accepted_flags: [...e.flags],
      review_status: (e.manual
        ? "corrected"
        : "confirmed") as Event["review_status"],
    }));
    eventsRef.current = accepted;
    dispatch({ type: "events", value: accepted });
    setNotice(
      "All events accepted, including uncertainty. Missing values stay undocumented.",
    );
  }
  const navRoot = useRef<HTMLElement>(null);
  const [navBox, setNavBox] = useState<{ top: number; height: number } | null>(
    null,
  );
  const moveNav = useCallback((node: HTMLElement | null) => {
    if (node) setNavBox({ top: node.offsetTop, height: node.offsetHeight });
  }, []);
  useLayoutEffect(() => {
    const place = () =>
      moveNav(
        navRoot.current?.querySelector<HTMLElement>('[aria-current="page"]') ||
          null,
      );
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [page, sidebarOpen, !!state.extraction, moveNav]);
  const pageTitle: Record<string, string> = {
    overview: "Overview",
    capture: "Capture note",

    review: "Review events",
    dashboard: "Patient overview",
    patients: "Patients",
    records: "Record library",
  };
  return (
    <div
      className={`app-shell ${sidebarOpen ? "sidebar-open" : "sidebar-collapsed"}`}
    >
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>
      <aside
        id="main-sidebar"
        className="sidebar"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setSidebarOpen(false);
            document
              .querySelector<HTMLButtonElement>(".sidebar-toggle")
              ?.focus();
          }
        }}
      >
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage("capture");
          }}
        >
          <span className="brand-icon">
            <Icon name="pulse" size={23} />
          </span>
          <span>
            Field<span className="brand-light"> / Record</span>
          </span>
        </a>
        <nav
          ref={navRoot}
          aria-label="Main navigation"
          onPointerLeave={() =>
            moveNav(
              navRoot.current?.querySelector<HTMLElement>(
                '[aria-current="page"]',
              ) || null,
            )
          }
        >
          {navBox ? (
            <span
              className="nav-glider"
              aria-hidden="true"
              style={{
                height: navBox.height,
                transform: `translateY(${navBox.top}px)`,
              }}
            />
          ) : null}
          {[
            ["overview", "Overview"],
            ["capture", "Capture note"],
            ["dashboard", "Patient overview"],
            ["patients", "Patients"],
            ["records", "Record library"],
          ].map(([key, label]) => (
            <button
              key={key}
              aria-label={label}

              onPointerEnter={(e) => {
                moveNav(e.currentTarget);
                if (!sidebarOpen) setNavTip({ anchor: e.currentTarget, label });
              }}

              onPointerLeave={() => setNavTip(null)}

              onFocus={(e) => {
                moveNav(e.currentTarget);
                if (!sidebarOpen) setNavTip({ anchor: e.currentTarget, label });
              }}

              onBlur={() => setNavTip(null)}
              disabled={busy || live}
              aria-current={page === key ? "page" : undefined}
              onClick={() => {
                setNavTip(null);
                setPage(key);
              }}
            >
              <Icon name={key} />
              <span>{label}</span>
              {key === "patients" ? (
                <span className="nav-count">{patients.length}</span>
              ) : null}
            </button>
          ))}
          {state.extraction ? (
            <button
              aria-label="Review events"

              onPointerEnter={(e) => {
                moveNav(e.currentTarget);
                if (!sidebarOpen)
                  setNavTip({
                    anchor: e.currentTarget,
                    label: "Review events",
                  });
              }}

              onPointerLeave={() => setNavTip(null)}

              onFocus={(e) => {
                moveNav(e.currentTarget);
                if (!sidebarOpen)
                  setNavTip({
                    anchor: e.currentTarget,
                    label: "Review events",
                  });
              }}

              onBlur={() => setNavTip(null)}
              aria-current={page === "review" ? "page" : undefined}
              disabled={busy || live}

              onClick={() => {
                setNavTip(null);
                setPage("review");
              }}
            >
              <Icon name="check" />
              <span>Review events</span>
              <span className="nav-count">{state.events.length}</span>
            </button>
          ) : null}
        </nav>
        <div className="sidebar-bottom">
          <button
            className="theme-toggle"
            aria-label={
              theme === "light" ? "Switch to dark" : "Switch to light"
            }
            onClick={toggleTheme}
          >
            <Icon name="moon" />
            {theme === "light" ? "Switch to dark" : "Switch to light"}
          </button>
          <div className="sidebar-footer">
            <span className="avatar small">FR</span>
            <span>
              Responder workspace<small>Hackathon prototype</small>
            </span>
          </div>
        </div>
      </aside>
      <div
        className="main-shell"
        onPointerDown={(e) => {
          if (
            sidebarOpen &&
            window.innerWidth < 600 &&
            !(e.target as Element).closest(".sidebar-toggle")
          )
            setSidebarOpen(false);
        }}
      >
        <header className="topbar">
          <button
            className="icon-button sidebar-toggle"
            aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            aria-controls="main-sidebar"
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen((open) => !open)}
          >
            <Icon name="menu" />
          </button>
          <div className="breadcrumb">
            <span>Workspace</span>
            <span>/</span>
            <strong>{pageTitle[page]}</strong>
          </div>
          <div className="service-status">
            <span className={`status-dot ${apiReady ? "online" : ""}`} />
            {apiReady ? "Online" : "Connecting"}
            <Notifications store={notifications} />
          </div>
        </header>
        <main id="workspace">
          {page !== "overview" ? (
            <div className="patient-context">
              <div>
                <Icon name="patients" />
                <span>
                  {patient ? (
                    <>
                      <strong>{patient.name}</strong>
                      <small>
                        {patient.age} years ·{" "}
                        {patient.gender.replaceAll("_", " ")} · ID{" "}
                        {patient.patient_id.slice(0, 8)}
                      </small>
                    </>
                  ) : (
                    <>
                      <strong>No patient selected</strong>
                      <small>Select a patient to save</small>
                    </>
                  )}
                </span>
              </div>
              <div>
                <Select
                  aria-label="Active patient"
                  value={patient?.patient_id || ""}
                  disabled={busy || live}
                  onChange={(e) => {
                    const next = patients.find(
                      (p) => p.patient_id === e.target.value,
                    );
                    if (next) choosePatient(next);
                  }}
                >
                  <option value="">Select patient</option>
                  {patients.map((p) => (
                    <option key={p.patient_id} value={p.patient_id}>
                      {p.name} · {p.age} · {p.patient_id.slice(0, 6)}
                    </option>
                  ))}
                </Select>
                <button
                  disabled={busy || live}
                  onClick={() => setPage("patients")}
                >
                  <Icon name="plus" size={16} />
                  New patient
                </button>
              </div>
            </div>
          ) : null}
          {page === "overview" ? (
            <Overview
              onOpen={(id) => void openRecord(id)}
              onCapture={() => setPage("capture")}
            />
          ) : null}
          {page === "capture" ? (
            <>
              <div className="capture-intro">
                <div>
                  <h1>Capture note</h1>
                  <p>
                    Speak an on-scene note. Review every detail before it
                    becomes a record.
                  </p>
                </div>
                <span className="reference-tag">
                  <Icon name="mic" size={14} /> Local dictation
                </span>
              </div>
              <div className="capture-grid">
                <div className="capture-main">
                  <section
                    className={`capture-studio panel ${live ? "is-listening" : ""}`}
                    aria-label="Capture note"
                  >
                    <div className="studio-top">
                      <span className="live-indicator">
                        <span
                          className={`status-dot ${speechReady ? "online" : ""}`}
                        />
                        {live
                          ? "Listening locally"
                          : speechReady
                            ? "Ready to record"
                            : "Preparing speech"}
                      </span>
                      <span className="shortcut-label">VOICE OR TEXT</span>
                    </div>
                    <div className="mic-area">
                      <button
                        className={`mic-button ${live ? "record-stop" : ""}`}
                        aria-label={
                          live ? "Stop microphone" : "Start microphone"
                        }
                        disabled={busy}
                        onClick={() =>
                          live ? void speech.current?.stop() : void startLive()
                        }
                      >
                        <Icon name="mic" size={34} />
                      </button>
                      <h2>
                        {live
                          ? "Listening to your note…"
                          : "Start with your voice"}
                      </h2>
                      <p>
                        {live
                          ? "Pause briefly between events. Stop when your paragraph is complete."
                          : "Speak naturally"}
                      </p>
                      {live ? (
                        <button
                          className="primary"
                          onClick={() => void speech.current?.stop()}
                        >
                          Stop & extract
                        </button>
                      ) : (
                        <button
                          className="link"
                          disabled={busy}
                          onClick={() => void startLive()}
                        >
                          Start speaking <Icon name="arrow" size={16} />
                        </button>
                      )}
                    </div>
                    {live ? (
                      <div className="live-preview" aria-live="polite">
                        <div className="waveform">
                          {Array.from({ length: 24 }, (_, i) => (
                            <i
                              key={i}
                              style={{ animationDelay: `${i * 0.06}s` }}
                            />
                          ))}
                        </div>
                        <span className="eyebrow">
                          PROVISIONAL · MAY CHANGE
                        </span>
                        <p>{partial || "Waiting for the next phrase…"}</p>
                        {liveEvents.length ? (
                          <div className="live-chips">
                            {liveEvents.map((e, i) => (
                              <span key={i}>
                                {e.medication || e.description}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="narrative-input">
                      <div>
                        <label htmlFor="narrative">Your note</label>
                        <span>
                          {state.narrative.length.toLocaleString()} / 20,000
                        </span>
                      </div>
                      <textarea
                        id="narrative"
                        aria-label="On-scene narrative"
                        maxLength={20000}
                        rows={6}
                        disabled={live || busy}
                        value={state.narrative}
                        onChange={(e) => changeNarrative(e.target.value)}
                        placeholder="Speak or type a note…"
                      />
                    </div>
                    <div className="capture-actions">
                      <div>
                        <label className="upload-button">
                          <Icon name="capture" size={16} />
                          Upload audio
                          <input
                            type="file"
                            accept="audio/*"
                            disabled={busy || live}
                            onChange={(e) => {
                              void transcribe(e.target.files?.[0]);
                              e.target.value = "";
                            }}
                          />
                        </label>
                        <button
                          className="link"
                          disabled={busy || live}
                          onClick={() => changeNarrative(sample)}
                        >
                          Load example
                        </button>
                        <button
                          className="link"
                          disabled={busy || live}
                          onClick={() => changeNarrative("")}
                        >
                          Clear note
                        </button>
                      </div>
                      <button
                        className="primary"
                        disabled={busy || live || !state.narrative.trim()}
                        onClick={() => void extract()}
                      >
                        {busy ? "Processing…" : "Extract events"}
                        <Icon name="arrow" size={16} />
                      </button>
                    </div>
                  </section>
                  <div className="capture-promises" hidden>
                    <span>
                      <Icon name="shield" size={17} />
                      Local speech processing
                    </span>
                    <span>
                      <Icon name="check" size={17} />
                      Evidence-linked events
                    </span>
                    <span>
                      <Icon name="records" size={17} />
                      Review before saving
                    </span>
                  </div>
                  <details className="encounter-details panel">
                    <summary>
                      Encounter details{" "}
                      <span>Case, responder, date & time zone</span>
                    </summary>
                    <div className="form-grid four">
                      <label>
                        Case ID
                        <input
                          value={caseId}
                          onChange={(e) => setCaseId(e.target.value)}
                          disabled={busy || live}
                        />
                      </label>
                      <label>
                        Responder / reviewer
                        <input
                          value={responder}
                          onChange={(e) => setResponder(e.target.value)}
                          disabled={busy || live}
                        />
                      </label>
                      <label>
                        Encounter date
                        <input
                          type="date"
                          value={encounterDate}
                          onChange={(e) => setEncounterDate(e.target.value)}
                          disabled={busy || live}
                        />
                      </label>
                      <label>
                        Time zone
                        <input
                          value={tz}
                          onChange={(e) => setTz(e.target.value)}
                          disabled={busy || live}
                        />
                      </label>
                    </div>
                  </details>
                </div>
                <aside className="capture-rail panel">
                  <div className="rail-title">
                    <h2>Patient workspace</h2>
                    <Icon name="patients" size={16} />
                  </div>
                  <div className="rail-patient">
                    <span className="avatar">
                      {patient ? patient.name.slice(0, 2).toUpperCase() : "—"}
                    </span>
                    <strong>{patient?.name || "No patient selected"}</strong>
                    <p>
                      {patient
                        ? `${patient.age} years · ${patient.gender.replaceAll("_", " ")}`
                        : "Select a patient"}
                    </p>
                  </div>
                  <div className="rail-date">
                    <Icon name="clock" size={15} />
                    {encounterDate}
                  </div>
                  <div className="rail-numbers">
                    <div>
                      <span>Saved notes</span>
                      <strong>{patientRecords.length}</strong>
                    </div>
                    <div>
                      <span>Current events</span>
                      <strong>{state.events.length}</strong>
                    </div>
                  </div>
                  <h3>Recent captures</h3>
                  {patientRecords.length ? (
                    patientRecords.slice(0, 4).map((r) => (
                      <button
                        className="rail-record"
                        key={r.record_id}
                        onClick={() => void openRecord(r.record_id)}
                        disabled={busy || live}
                      >
                        <span>
                          {r.encounter_date || r.created_at.slice(0, 10)}
                          <small>
                            {r.events.length} events ·{" "}
                            {r.record_status.replaceAll("_", " ")}
                          </small>
                        </span>
                        <Icon name="arrow" size={14} />
                      </button>
                    ))
                  ) : (
                    <div className="rail-empty">
                      <Icon name="records" size={22} />
                      <p>No notes yet</p>
                    </div>
                  )}
                  <div className="rail-note">
                    <Icon name="shield" size={15} />
                    <span>Local processing. Review required.</span>
                  </div>
                </aside>
              </div>
            </>
          ) : null}
          {page === "patients" ? (
            <>
              <div className="page-intro">
                <div>
                  <span className="eyebrow">PATIENT WORKSPACE</span>
                  <h1>Patients</h1>
                  <p>
                    Register a patient, select their profile and start a new
                    note.
                  </p>
                </div>
              </div>
              <PatientDirectory
                patients={patients}
                selected={patient}
                onSelect={choosePatient}
                onCreate={registerPatient}
                busy={busy || live}
              />
            </>
          ) : null}
          {page === "dashboard" ? (
            <PatientDashboard
              key={patient?.patient_id || "none"}
              patient={patient}
              records={patientRecords}
              draft={patient && !state.recordId ? state.events : []}
              draftDate={encounterDate}
              onCapture={() => {
                if (state.recordId) {
                  dispatch({ type: "narrative", value: "" });
                  setRevisions([]);
                }
                setPage("capture");
              }}
              onNavigate={(next) => {
                setPage(next);
              }}
              onOpen={(id) => void openRecord(id)}
            />
          ) : null}
          {page === "review" ? (
            <>
              <div className="page-intro">
                <div>
                  <span className="eyebrow">REVIEW & CONFIRM</span>

                  <h1>Review events</h1>
                  <p>
                    Inspect the original words, resolve uncertainty and accept
                    the extracted events.
                  </p>
                </div>

                <div className="review-header-actions">
                  <button onClick={showTranscription}>
                    <Icon name="records" size={16} />
                    Original transcription
                  </button>

                  <button onClick={() => setPage("capture")}>
                    <Icon name="capture" size={16} />
                    Back to capture
                  </button>
                </div>
              </div>
              <div className="review-toolbar panel">
                <div>
                  <strong>
                    {reviewedCount} / {state.events.length}
                  </strong>
                  <span> events accepted</span>
                  <div className="review-progress">
                    <span
                      style={{
                        width: `${state.events.length ? (reviewedCount / state.events.length) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
                <button
                  className="primary"
                  aria-label="Accept all events"
                  disabled={!state.events.length || allReviewed || busy}
                  onClick={acceptAll}
                >
                  <Icon name="check" size={17} />
                  Accept all
                </button>
              </div>
              <div className="review-layout">
                <section className="review-column">
                  <div className="event-filters">
                    <label>
                      <span className="sr-only">Filter events</span>
                      <Select
                        aria-label="Filter events"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                      >
                        <option value="all">
                          All events ({state.events.length})
                        </option>
                        <option value="medication_administration">
                          Medications
                        </option>
                        <option value="procedure">Procedures</option>
                        <option value="observation">All observations</option>
                        {Object.entries(metrics).map(([key, m]) => (
                          <option key={key} value={key}>
                            {m.label}
                          </option>
                        ))}
                        <option value="unclassified">Other statements</option>
                        <option value="needs_review">Awaiting review</option>
                      </Select>
                    </label>
                    <span className="help">
                      Showing {visibleEvents.length} of {state.events.length}
                    </span>
                  </div>

                  <EventTable
                    events={state.events}
                    visible={visibleEvents}
                    update={update}
                    remove={remove}
                    select={select}
                  />
                  <button className="add-event" onClick={addEvent}>
                    <Icon name="plus" size={16} />
                    Add a missed event
                  </button>
                  <div className="save-bar panel">
                    <div>
                      <strong>
                        {allReviewed
                          ? "Ready for your final check"
                          : "Review in progress"}
                      </strong>
                      <small>
                        {patient
                          ? `Saving to ${patient.name}`
                          : "Select or register a patient before saving"}
                      </small>
                    </div>
                    <div>
                      <button
                        disabled={busy || !state.extraction || !patient}
                        onClick={() => void save(false)}
                      >
                        Save draft
                      </button>
                      {!allReviewed && state.events.length ? (
                        <button
                          onClick={acceptAll}
                          disabled={busy}
                          aria-label="Accept all including uncertainty"
                        >
                          <Icon name="check" size={16} />
                          Accept all
                        </button>
                      ) : null}
                      <button
                        className="primary"
                        disabled={busy || !allReviewed || !patient}
                        onClick={() => void save(true)}
                      >
                        Confirm & save
                        <Icon name="check" size={16} />
                      </button>
                    </div>
                  </div>
                  {state.recordId ? (
                    <RecordMenu
                      key={`${state.recordId}:${state.version}`}
                      recordId={state.recordId}
                      version={state.version}
                      revisions={revisions}
                      busy={busy}
                      onRevision={(version) =>
                        void openRecord(state.recordId, version)
                      }
                      notify={setNotice}
                    />
                  ) : null}
                </section>
              </div>
            </>
          ) : null}
          {page === "records" ? (
            <>
              <div className="page-intro">
                <div>
                  <span className="eyebrow">LOCAL RECORD LIBRARY</span>
                  <h1>Records</h1>
                  <p></p>
                </div>
              </div>
              <section className="panel">
                <form
                  className="record-search"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void loadHistory();
                  }}
                >
                  <Icon name="search" />
                  <input
                    aria-label="Search records"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Case, responder or record ID"
                  />
                  <button className="primary">Search</button>
                </form>
                <div className="record-list" aria-busy={historyLoading}>
                  {visibleHistory.map((r) => (
                    <button
                      key={r.record_id}
                      onClick={() => void openRecord(r.record_id)}
                    >
                      <span className="avatar">
                        <Icon name="records" />
                      </span>
                      <span>
                        <strong>
                          {r.patient?.name || "Unassigned legacy record"}
                        </strong>
                        <small>
                          {r.case_id} · {r.event_count} events · revision{" "}
                          {r.version}
                        </small>
                      </span>
                      <span className="badge reported">
                        {r.record_status.replaceAll("_", " ")}
                      </span>
                      <Icon name="arrow" size={17} />
                    </button>
                  ))}
                  {!visibleHistory.length ? (
                    <div className="empty-state">
                      <Icon name="records" size={32} />
                      <h3>
                        {historyLoading
                          ? "Loading records…"
                          : "No matching records"}
                      </h3>
                      <p>
                        {historyLoading
                          ? ""
                          : patient
                            ? "No saved notes match this patient and search."
                            : "Select a patient or try a different search."}
                      </p>
                    </div>
                  ) : null}
                </div>
              </section>
            </>
          ) : null}
          <footer>
            <span>Synthetic demo · Not for clinical use</span>
            <a href="/credits.html" target="_blank" rel="noreferrer">
              Credits
            </a>
          </footer>
        </main>
      </div>

      {navTip && !sidebarOpen ? (
        <FloatingTip anchor={navTip.anchor} side="right">
          {navTip.label}
        </FloatingTip>
      ) : null}

      {transcriptOpen ? (
        <div
          className="dialog-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setTranscriptOpen(false);
          }}
        >
          <section
            className="panel transcription-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Original transcription"

            onKeyDown={(e) => {
              if (e.key === "Escape") setTranscriptOpen(false);

              if (e.key === "Tab") {
                e.preventDefault();
                e.currentTarget
                  .querySelector<HTMLButtonElement>("button")
                  ?.focus();
              }
            }}
          >
            <header>
              <div>
                <h2>Original transcription</h2>
                <small>
                  {encounterDate} · {tz}
                </small>
              </div>

              <button
                className="icon-button"
                autoFocus
                aria-label="Close transcription"
                onClick={() => setTranscriptOpen(false)}
              >
                <Icon name="close" />
              </button>
            </header>

            <div className="transcript">
              {span ? (
                <>
                  {Array.from(state.narrative).slice(0, span[0]).join("")}
                  <mark>
                    {Array.from(state.narrative)
                      .slice(...span)
                      .join("")}
                  </mark>
                  {Array.from(state.narrative).slice(span[1]).join("")}
                </>
              ) : (
                state.narrative
              )}
            </div>
          </section>
        </div>
      ) : null}
      {pendingPatient ? (
        <div className="dialog-backdrop">
          <section
            className="bulk-dialog panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="switch-title"
            onKeyDown={(e) => {
              if (e.key === "Escape") setPendingPatient(null);
              if (e.key === "Tab") {
                const controls = e.currentTarget.querySelectorAll("button");
                if (e.shiftKey && document.activeElement === controls[0]) {
                  e.preventDefault();
                  controls[1].focus();
                } else if (
                  !e.shiftKey &&
                  document.activeElement === controls[1]
                ) {
                  e.preventDefault();
                  controls[0].focus();
                }
              }
            }}
          >
            <h2 id="switch-title">Switch patient?</h2>
            <p>The current note will close. Saved records stay in history.</p>
            <div className="dialog-actions">
              <button autoFocus onClick={() => setPendingPatient(null)}>
                Cancel
              </button>
              <button
                className="primary"
                onClick={() => {
                  dispatch({ type: "narrative", value: "" });

                  setPatient(pendingPatient);
                  setPendingPatient(null);
                  setPage((current) =>
                    ["records", "dashboard"].includes(current)
                      ? current
                      : "capture",
                  );
                  setFilter("all");
                }}
              >
                Switch patient
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
