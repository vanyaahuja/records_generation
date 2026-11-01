import { useMemo, useState, type FormEvent } from "react";
import type { Patient, PatientCreate } from "./generated";
import type { Event } from "./state";

export type PatientProfile = Patient;
export type PatientRecord = {
  record_id: string;
  version: number;
  case_id: string;
  record_status: string;
  created_at: string;
  encounter_date: string | null;
  events: Event[];
  patient?: Patient | null;
};
export const metrics = {
  blood_pressure: { label: "Blood pressure", unit: "mmHg" },
  heart_rate: { label: "Heart rate", unit: "beats/min" },
  spo2: { label: "Oxygen saturation", unit: "%" },
  respiratory_rate: { label: "Respiratory rate", unit: "breaths/min" },
  temperature: { label: "Temperature", unit: "°C" },
};
export type Metric = keyof typeof metrics;

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, string> = {
    capture: "M12 3v12m-4-4 4 4 4-4M5 15v5h14v-5",
    dashboard: "M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z",
    patients:
      "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m8-7a4 4 0 0 1 0 8m5 9v-2a4 4 0 0 0-3-4",
    records: "M6 3h9l4 4v14H6zM14 3v5h5M9 12h7m-7 4h7",
    mic: "M9 6a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0zm-4 6a7 7 0 0 0 14 0m-7 7v3m-4 0h8",
    pulse: "M2 12h5l3-8 4 16 3-8h5",
    check: "m5 12 4 4L19 6",
    arrow: "M5 12h14m-5-5 5 5-5 5",
    plus: "M12 5v14M5 12h14",
    moon: "M20 15A9 9 0 0 1 9 3a9 9 0 1 0 11 12",
    search: "m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
    shield: "m12 3 9 4v6c0 4-9 9-9 9s-9-5-9-9V7zm-4 9 3 3 5-6",
    clock: "M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] || paths.pulse} />
    </svg>
  );
}

export function PatientDirectory({
  patients,
  selected,
  onSelect,
  onCreate,
  busy,
}: {
  patients: Patient[];
  selected: Patient | null;
  onSelect: (p: Patient) => void;
  onCreate: (p: PatientCreate) => Promise<void>;
  busy: boolean;
}) {
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] =
    useState<PatientCreate["gender"]>("not_specified");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      await onCreate({ name: name.trim(), age: Number(age), gender });
      setName("");
      setAge("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  const matches = patients.filter((p) =>
    `${p.name} ${p.patient_id}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="directory-grid">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">YOUR WORKSPACE</span>
            <h2>
              Patient directory <span className="count">{patients.length}</span>
            </h2>
          </div>
        </div>
        <label className="search-field">
          <Icon name="search" />
          <input
            aria-label="Search patients"
            placeholder="Search by name or patient ID"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="patient-list">
          {matches.map((p) => (
            <button
              className={`patient-row ${selected?.patient_id === p.patient_id ? "selected" : ""}`}
              key={p.patient_id}
              onClick={() => onSelect(p)}
              disabled={busy}
            >
              <span className="avatar">{p.name.slice(0, 2).toUpperCase()}</span>
              <span>
                <strong>{p.name}</strong>
                <small>
                  {p.age} years · {p.gender.replaceAll("_", " ")} ·{" "}
                  {p.patient_id.slice(0, 8)}
                </small>
              </span>
              <Icon name="arrow" />
            </button>
          ))}
          {!matches.length ? (
            <div className="empty-state">
              <Icon name="patients" size={30} />
              <h3>
                {patients.length
                  ? "No matching patients"
                  : "Your patients belong here"}
              </h3>
              <p>
                Register a synthetic patient to keep their notes and
                observations together.
              </p>
            </div>
          ) : null}
        </div>
        <p className="help">
          Up to 1,000 most recent profiles. Matching names remain separate
          patient IDs.
        </p>
      </section>
      <section className="panel registration">
        <span className="eyebrow">NEW PATIENT</span>
        <h2>A little context first.</h2>
        <p>Create a profile, then capture their on-scene note.</p>
        <form onSubmit={submit}>
          <label>
            Patient name
            <input
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Synthetic Alex"
            />
          </label>
          <div className="form-grid">
            <label>
              Age
              <input
                required
                type="number"
                min="0"
                max="130"
                step="1"
                value={age}
                onChange={(e) => setAge(e.target.value)}
                placeholder="Years"
              />
            </label>
            <label>
              Gender
              <select
                aria-label="Gender"
                value={gender}
                onChange={(e) =>
                  setGender(e.target.value as PatientCreate["gender"])
                }
              >
                <option value="not_specified">Not specified</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="nonbinary">Nonbinary</option>
                <option value="other">Other</option>
              </select>
            </label>
          </div>
          {error ? (
            <p role="alert" className="form-error">
              {error}
            </p>
          ) : null}
          <button className="primary" disabled={busy || saving || !name.trim()}>
            <Icon name="plus" />
            {saving ? "Registering…" : "Register patient"}
          </button>
        </form>
        <div className="privacy-note">
          <Icon name="shield" />
          <span>
            Synthetic profiles only. Stored on your local service, with no cloud
            account required.
          </span>
        </div>
      </section>
    </div>
  );
}

type Point = {
  time: string;
  label: string;
  value: number;
  secondary?: number;
  unit: string;
};
export function PatientDashboard({
  patient,
  records,
  draft,
  draftDate,
  onCapture,
  onOpen,
}: {
  patient: Patient | null;
  records: PatientRecord[];
  draft: Event[];
  draftDate: string;
  onCapture: () => void;
  onOpen: (id: string) => void;
}) {
  const [metric, setMetric] = useState<Metric>("blood_pressure");
  const [range, setRange] = useState("all");
  const all = useMemo(
    () => [
      ...records.flatMap((r) =>
        r.events.map((e) => ({
          event: e,
          date: r.encounter_date || r.created_at.slice(0, 10),
          draft: r.record_status !== "reviewed",
        })),
      ),
      ...draft.map((event) => ({ event, date: draftDate, draft: true })),
    ],
    [records, draft, draftDate],
  );
  const points = useMemo(
    () =>
      all
        .filter(
          ({ event: e, date }) =>
            e.event_type === "observation" &&
            e.action_status === "completed" &&
            e.observation?.type === metric &&
            /^\d{2}:\d{2}$/.test(e.event_time || "") &&
            !e.flags.some((flag) =>
              ["ambiguous_am_pm", "relative_date_rollover"].includes(flag),
            ) &&
            (range === "all" || date === range),
        )
        .flatMap(({ event: e, date, draft }) => {
          const obs = e.observation!;
          const value = metric === "blood_pressure" ? obs.systolic : obs.value;
          const secondary =
            metric === "blood_pressure" ? obs.diastolic : undefined;
          if (
            typeof value !== "number" ||
            !Number.isFinite(value) ||
            (metric === "blood_pressure" &&
              (typeof secondary !== "number" || !Number.isFinite(secondary)))
          )
            return [];
          const rawUnit = String(obs.unit || "");
          const unit =
            metric === "temperature" && rawUnit === "Cel" ? "°C" : rawUnit;
          if (unit !== metrics[metric].unit) return [];
          return [
            {
              time: `${date}T${e.event_time}`,
              label: `${date} ${e.event_time}${draft ? " · draft / unreviewed" : ""}`,
              value,
              secondary: typeof secondary === "number" ? secondary : undefined,
              unit,
            },
          ];
        })
        .sort((a, b) => a.time.localeCompare(b.time)),
    [all, metric, range],
  );
  const dates = [...new Set(all.map((p) => p.date))].sort().reverse();
  const eventCount = all.length;
  const observationCount = all.filter(
    (p) => p.event.event_type === "observation",
  ).length;
  const flags = all.filter(
    (p) =>
      p.event.flags.length &&
      p.event.review_status === "needs_human_confirmation",
  ).length;
  return (
    <>
      <div className="page-intro">
        <div>
          <span className="eyebrow">PATIENT OVERVIEW</span>
          <h1>
            {patient
              ? `${patient.name}’s workspace`
              : "A clear view of every detail."}
          </h1>
          <p>
            {patient
              ? `${patient.age} years · ${patient.gender.replaceAll("_", " ")} · ${patient.patient_id.slice(0, 8)}`
              : "Select a patient to explore their recorded observations."}
          </p>
        </div>
        <button className="primary" onClick={onCapture}>
          <Icon name="plus" />
          Capture a note
        </button>
      </div>
      <div className="stats-row">
        {[
          ["Saved notes", records.length, "records"],
          ["Recorded events", eventCount, "pulse"],
          ["Observations", observationCount, "dashboard"],
        ].map(([label, value, icon]) => (
          <div className="stat-card" key={String(label)}>
            <span className="stat-label">
              {label}
              <Icon name={String(icon)} />
            </span>
            <strong className="stat-value">{value}</strong>
            <span className="stat-caption">
              {draft.length
                ? "Includes current unsaved extraction"
                : "From saved records"}
            </span>
          </div>
        ))}
      </div>
      <div className="analytics-grid">
        <section className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">OBSERVATION TRENDS</span>
              <h2>{metrics[metric].label}</h2>
            </div>
            <label className="inline-select">
              <span className="sr-only">Chart observation</span>
              <select
                aria-label="Chart observation"
                value={metric}
                onChange={(e) => setMetric(e.target.value as Metric)}
              >
                {Object.entries(metrics).map(([key, m]) => (
                  <option key={key} value={key}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="chart-toolbar">
            <span className="chart-reading">
              {points.length
                ? `${points.at(-1)!.value}${metric === "blood_pressure" ? `/${points.at(-1)!.secondary}` : ""}`
                : "—"}
              <small>{metrics[metric].unit}</small>
            </span>
            <select
              aria-label="Chart encounter date"
              value={range}
              onChange={(e) => setRange(e.target.value)}
            >
              <option value="all">All encounters</option>
              {dates.map((date) => (
                <option key={date}>{date}</option>
              ))}
            </select>
          </div>
          <ObservationChart points={points} metric={metric} />
          <p className="help">
            {points.length} plotted readings · Reported, timed values in{" "}
            {metrics[metric].unit} only. Drafts are labeled. Other units and
            unknown times are omitted; no values are inferred.
          </p>
        </section>
        <section className="panel activity-panel timeline-panel">
          <div className="panel-heading">
            <h2>Latest events</h2>
            <span className="count">{flags} to review</span>
          </div>
          <div className="timeline-date">
            {dates[0] || "No encounter selected"}
          </div>
          {all.length ? (
            all.slice(-7).map(({ event, date }, index) => (
              <div
                className="timeline-event"
                key={`${event.event_id}-${index}`}
              >
                <time>{event.event_time || "—"}</time>
                <div>
                  <strong>{event.medication || event.description}</strong>
                  <small>
                    {date} · {event.event_type.replaceAll("_", " ")}
                  </small>
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state">
              <Icon name="clock" />
              <p>Recorded events will appear here.</p>
            </div>
          )}
        </section>
      </div>
      <EventAnalytics records={records} draft={draft} />
      <details className="panel category-details">
        <summary>Category totals</summary>
        <section className="category-totals">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">CAPTURED ACTIVITY</span>
              <h2>Event breakdown</h2>
            </div>
          </div>
          {[
            "medication_administration",
            "procedure",
            "observation",
            "unclassified",
          ].map((kind) => {
            const count = all.filter((p) => p.event.event_type === kind).length;
            return (
              <div className="breakdown" key={kind}>
                <div>
                  <span>
                    {kind === "medication_administration"
                      ? "Medications"
                      : kind === "unclassified"
                        ? "Other statements"
                        : `${kind[0].toUpperCase()}${kind.slice(1)}s`}
                  </span>
                  <strong>{count}</strong>
                </div>
                <div className="bar-track">
                  <span
                    style={{
                      width: `${eventCount ? (count / eventCount) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            );
          })}
          <div className="privacy-note">
            <Icon name="shield" />
            <span>
              Documentation insights only. Counts and charts do not indicate a
              diagnosis or clinical status.
            </span>
          </div>
        </section>
      </details>
      <section className="panel recent-records">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">PATIENT HISTORY</span>
            <h2>Recent notes</h2>
          </div>
          <span className="help">Latest 100 notes</span>
        </div>
        {!records.length ? (
          <div className="empty-state">
            <Icon name="records" size={30} />
            <h3>No saved notes yet</h3>
            <p>
              Capture, review and save a note to build this patient’s history.
            </p>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Encounter</th>
                  <th>Case</th>
                  <th>Events</th>
                  <th>Review</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.record_id}>
                    <td>{r.encounter_date || r.created_at.slice(0, 10)}</td>
                    <td>{r.case_id}</td>
                    <td>{r.events.length}</td>
                    <td>
                      <span
                        className={`badge ${r.record_status === "reviewed" ? "reported" : "uncertain"}`}
                      >
                        {r.record_status.replaceAll("_", " ")}
                      </span>
                    </td>
                    <td>
                      <button
                        className="link"
                        onClick={() => onOpen(r.record_id)}
                      >
                        Open note <Icon name="arrow" size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function EventAnalytics({
  records,
  draft,
}: {
  records: PatientRecord[];
  draft: Event[];
}) {
  const kinds = ["medication_administration", "procedure", "observation"];
  const groups = new Map<string, number[]>();
  records.forEach((r) => {
    const date = r.encounter_date || r.created_at.slice(0, 10);
    const counts = groups.get(date) || [0, 0, 0];
    r.events.forEach((e) => {
      const index = kinds.indexOf(e.event_type);
      if (index >= 0) counts[index]++;
    });
    groups.set(date, counts);
  });
  const days = [...groups].sort(([a], [b]) => a.localeCompare(b)).slice(-7);
  const peak = Math.max(1, ...days.flatMap(([, counts]) => counts));
  const all = [...records.flatMap((r) => r.events), ...draft];
  const accepted = all.filter(
    (e) =>
      e.review_status !== "needs_human_confirmation" &&
      e.flags.every((f) => e.accepted_flags.includes(f)),
  ).length;
  const saved = records
    .filter((r) => r.record_status === "reviewed")
    .reduce((sum, r) => sum + r.events.length, 0);
  const stages = [all.length, accepted, saved];
  const labels = ["Documented", "Accepted", "Reviewed & saved"];
  return (
    <div className="lower-chart-grid">
      <section className="panel grouped-panel">
        <div className="panel-heading">
          <div>
            <h2>Event volume</h2>
            <p>Saved events · latest 7 encounter dates</p>
          </div>
          <Icon name="dashboard" size={16} />
        </div>
        <div className="mono-legend">
          <span>● Medication</span>
          <span>● Procedures</span>
          <span>● Observations</span>
        </div>
        {days.length ? (
          <svg
            className="grouped-chart"
            viewBox="0 0 560 195"
            role="img"
            aria-label="Saved medication, procedure and observation counts by encounter date"
          >
            {[0, 0.5, 1].map((n, i) => (
              <g key={i}>
                <line
                  x1="32"
                  x2="545"
                  y1={20 + n * 140}
                  y2={20 + n * 140}
                  className="chart-grid"
                />
                <text x="23" y={24 + n * 140} textAnchor="end">
                  {Math.round(peak * (1 - n))}
                </text>
              </g>
            ))}
            {days.map(([date, counts], i) => {
              const stride = 500 / days.length;
              return (
                <g key={date}>
                  {counts.map((count, j) => (
                    <rect
                      key={j}
                      x={40 + i * stride + j * 12}
                      y={160 - (count / peak) * 140}
                      width="8"
                      height={(count / peak) * 140}
                      rx="3"
                      className={`volume-bar volume-${j}`}
                    >
                      <title>
                        {date}: {kinds[j].replaceAll("_", " ")} {count}
                      </title>
                    </rect>
                  ))}
                  <text x={52 + i * stride} y="184" textAnchor="middle">
                    {date.slice(5)}
                  </text>
                </g>
              );
            })}
          </svg>
        ) : (
          <div className="empty-state small-empty">
            <Icon name="dashboard" />
            <p>Save a note to see event volume over time.</p>
          </div>
        )}
        <details className="chart-data">
          <summary>View event counts</summary>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Medication</th>
                  <th>Procedures</th>
                  <th>Observations</th>
                </tr>
              </thead>
              <tbody>
                {days.map(([date, counts]) => (
                  <tr key={date}>
                    <td>{date}</td>
                    {counts.map((count, j) => (
                      <td key={j}>{count}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>
      <section className="panel funnel-panel">
        <div className="panel-heading">
          <div>
            <h2>Review progress</h2>
            <p>Events through the documentation workflow</p>
          </div>
          <Icon name="check" size={16} />
        </div>
        <div className="funnel-labels">
          {stages.map((n, i) => (
            <div key={i}>
              <strong>{n}</strong>
              <span>{labels[i]}</span>
            </div>
          ))}
        </div>
        {all.length ? (
          <svg
            className="funnel-chart"
            viewBox="0 0 540 155"
            role="img"
            aria-label={`${stages[0]} documented, ${stages[1]} accepted, ${stages[2]} reviewed and saved events`}
          >
            {stages.map((n, i) => {
              const a = (n / all.length) * 112,
                b = ((stages[i + 1] ?? n) / all.length) * 112;
              const x = i * 180;
              return (
                <path
                  key={i}
                  d={`M${x},${78 - a / 2} C${x + 90},${78 - a / 2} ${x + 90},${78 - b / 2} ${x + 180},${78 - b / 2} L${x + 180},${78 + b / 2} C${x + 90},${78 + b / 2} ${x + 90},${78 + a / 2} ${x},${78 + a / 2} Z`}
                  className={`funnel-stage stage-${i}`}
                >
                  <title>
                    {labels[i]}: {n}
                  </title>
                </path>
              );
            })}
          </svg>
        ) : (
          <div className="empty-state small-empty">
            <Icon name="check" />
            <p>Captured events will build this review flow.</p>
          </div>
        )}
        <div className="funnel-percentages">
          {stages.map((n, i) => (
            <span key={i}>
              {all.length ? Math.round((n / all.length) * 100) : 0}%
            </span>
          ))}
        </div>
        <p className="help">
          Latest 100 notes plus the current draft. Review completion is a
          documentation measure, not a patient outcome.
        </p>
      </section>
    </div>
  );
}

function ObservationChart({
  points,
  metric,
}: {
  points: Point[];
  metric: Metric;
}) {
  if (!points.length)
    return (
      <div className="empty-state chart-empty">
        <Icon name="pulse" size={36} />
        <h3>No {metrics[metric].label.toLowerCase()} readings yet</h3>
        <p>
          Reported observations with a time and matching unit will appear here.
        </p>
      </div>
    );
  const values = points.flatMap((p) =>
    p.secondary === undefined ? [p.value] : [p.value, p.secondary],
  );
  const low = Math.min(...values),
    high = Math.max(...values);
  const pad = Math.max((high - low) * 0.2, 5);
  const min = low - pad,
    max = high + pad;
  const timestamps = points.map((p) => Date.parse(p.time + ":00Z"));
  const first = Math.min(...timestamps),
    last = Math.max(...timestamps);
  const x = (i: number) =>
    first === last
      ? 320
      : 54 + ((timestamps[i] - first) / (last - first)) * 566;
  const y = (v: number) => 180 - ((v - min) / (max - min)) * 150;
  const line = (secondary = false) =>
    points
      .map((p, i) => `${x(i)},${y(secondary ? p.secondary! : p.value)}`)
      .join(" ");
  return (
    <>
      <svg
        className="observation-chart"
        viewBox="0 0 650 220"
        role="img"
        aria-label={`${metrics[metric].label} over reported time. ${points.length} readings. Values listed below.`}
      >
        <defs>
          <linearGradient id={`area-${metric}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity=".15" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        {points.length > 1 ? (
          <polygon
            points={`${x(0)},180 ${line()} ${x(points.length - 1)},180`}
            fill={`url(#area-${metric})`}
            className="chart-area"
          />
        ) : null}
        {[0, 0.5, 1].map((n, i) => (
          <g key={i}>
            <line
              x1="54"
              x2="620"
              y1={30 + n * 150}
              y2={30 + n * 150}
              className="chart-grid"
            />
            <text x="43" y={34 + n * 150} textAnchor="end">
              {Math.round(max - n * (max - min))}
            </text>
          </g>
        ))}
        {points.length > 1 ? (
          <polyline points={line()} className="chart-line" />
        ) : null}
        {metric === "blood_pressure" && points.length > 1 ? (
          <polyline points={line(true)} className="chart-line secondary-line" />
        ) : null}
        {points.map((p, i) => (
          <g key={`${p.time}-${i}`}>
            <circle cx={x(i)} cy={y(p.value)} r="4.5" className="chart-dot">
              <title>
                {p.label}: {p.value}
                {p.secondary !== undefined ? `/${p.secondary}` : ""} {p.unit}
              </title>
            </circle>
            {p.secondary !== undefined ? (
              <circle
                cx={x(i)}
                cy={y(p.secondary)}
                r="4"
                className="chart-dot secondary-dot"
              >
                <title>
                  {p.label}: diastolic {p.secondary} {p.unit}
                </title>
              </circle>
            ) : null}
            {i === 0 || i === points.length - 1 ? (
              <text x={x(i)} y="208" textAnchor="middle">
                {p.time.slice(11, 16)}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
      <div className="chart-legend">
        <span>
          ● {metric === "blood_pressure" ? "Systolic" : metrics[metric].label}
        </span>
        {metric === "blood_pressure" ? <span>● Diastolic</span> : null}
      </div>
      <details className="chart-data">
        <summary>View readings as a table</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Reported time</th>
                <th>Reading</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p, i) => (
                <tr key={i}>
                  <td>{p.label}</td>
                  <td>
                    {p.value}
                    {p.secondary !== undefined ? `/${p.secondary}` : ""}{" "}
                    {p.unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
