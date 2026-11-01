import { Icon } from "./Icons";
import { Select } from "./Controls";
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

export { Icon } from "./Icons";
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
                {patients.length ? "No matching patients" : "No patients yet"}
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
        <h2>New patient</h2>
        <p></p>
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
              <Select
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
              </Select>
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
  onNavigate,
}: {
  patient: Patient | null;
  records: PatientRecord[];
  draft: Event[];
  draftDate: string;
  onCapture: () => void;
  onOpen: (id: string) => void;
  onNavigate: (page: string) => void;
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
    (p) => p.event.review_status === "needs_human_confirmation",
  ).length;
  return (
    <>
      <div className="page-intro">
        <div>
          <span className="eyebrow">PATIENT OVERVIEW</span>
          <h1>{patient ? "Overview" : "Overview"}</h1>
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
          ["To review", flags, "clock"],
        ].map(([label, value, icon]) => (
          <div className="stat-card" key={String(label)}>
            <span className="stat-label">
              {label}
              <Icon name={String(icon)} />
            </span>
            <strong className="stat-value">{value}</strong>
            <svg
              className="stat-sparkline"
              width="45"
              height="28"
              viewBox="0 0 45 28"
              aria-hidden="true"
            >
              {dates
                .slice(0, 6)
                .sort()
                .map((date, index, array) => {
                  const numbers = array.map((day) =>
                    label === "Saved notes"
                      ? records.filter(
                          (r) =>
                            (r.encounter_date || r.created_at.slice(0, 10)) ===
                            day,
                        ).length
                      : all.filter(
                          (p) =>
                            p.date === day &&
                            (label === "Observations"
                              ? p.event.event_type === "observation"
                              : label === "To review"
                                ? p.event.review_status ===
                                  "needs_human_confirmation"
                                : true),
                        ).length,
                  );
                  const height =
                    (numbers[index] / Math.max(1, ...numbers)) * 24;
                  return (
                    <rect
                      key={date}
                      x={index * 7 + 2}
                      y={28 - height}
                      width="5"
                      height={height}
                      rx="1.5"
                    />
                  );
                })}
            </svg>
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
              <Select
                aria-label="Chart observation"
                value={metric}
                onChange={(e) => setMetric(e.target.value as Metric)}
              >
                {Object.entries(metrics).map(([key, m]) => (
                  <option key={key} value={key}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </label>
          </div>
          <div className="chart-toolbar">
            <span className="chart-reading">
              {points.length
                ? `${points.at(-1)!.value}${metric === "blood_pressure" ? `/${points.at(-1)!.secondary}` : ""}`
                : "—"}
              <small>{metrics[metric].unit}</small>
            </span>
            <Select
              aria-label="Chart encounter date"
              value={range}
              onChange={(e) => setRange(e.target.value)}
            >
              <option value="all">All encounters</option>
              {dates.map((date) => (
                <option key={date}>{date}</option>
              ))}
            </Select>
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
            <h2>Review activity</h2>
            <span>{flags} pending</span>
          </div>
          {[
            ...records.slice(0, 4).map((r) => ({
              id: r.record_id,
              label: r.case_id,
              date: r.encounter_date || r.created_at.slice(0, 10),
              events: r.events,
            })),
            ...(draft.length
              ? [
                  {
                    id: "draft",
                    label: "Current note",
                    date: draftDate,
                    events: draft,
                  },
                ]
              : []),
          ].map((note) => {
            const accepted = note.events.filter(
              (e) =>
                e.review_status !== "needs_human_confirmation" &&
                e.flags.every((f) => e.accepted_flags.includes(f)),
            ).length;
            const percent = note.events.length
              ? Math.round((accepted / note.events.length) * 100)
              : 0;
            return (
              <div className="review-activity" key={note.id}>
                <span className="activity-avatar">
                  <Icon name="records" size={15} />
                </span>
                <div>
                  <div>
                    <strong>{note.label}</strong>
                    <span>{percent}%</span>
                  </div>
                  <small>
                    {note.date} · {accepted}/{note.events.length} accepted
                  </small>
                  <div className="activity-track">
                    <span
                      style={{
                        width: `${percent}%`,
                        background:
                          percent === 100 ? "var(--mint)" : "var(--accent)",
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
          {!records.length && !draft.length ? (
            <div className="mini-empty">
              <Icon name="records" />
              <span>No notes yet</span>
            </div>
          ) : null}
        </section>
      </div>
      <EventAnalytics
        records={records}
        draft={draft}
        onCapture={onCapture}
        onPatients={() => onNavigate("patients")}
        onRecords={() => onNavigate("records")}
        onReview={() =>
          draft.length
            ? onNavigate("review")
            : records[0] && onOpen(records[0].record_id)
        }
      />
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
            <p></p>
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
  onCapture,
  onPatients,
  onRecords,
  onReview,
}: {
  records: PatientRecord[];
  draft: Event[];
  onCapture: () => void;
  onPatients: () => void;
  onRecords: () => void;
  onReview: () => void;
}) {
  const all = [...records.flatMap((r) => r.events), ...draft];
  const kinds = [
    ["medication_administration", "Medication"],
    ["procedure", "Procedures"],
    ["observation", "Observations"],
    ["unclassified", "Other"],
  ];
  const flags = new Map<string, number>();
  all.forEach((e) =>
    e.flags.forEach((flag) => flags.set(flag, (flags.get(flag) || 0) + 1)),
  );
  const ranked = [...flags].sort((a, b) => b[1] - a[1]).slice(0, 5);
  return (
    <div className="lower-chart-grid">
      <section className="panel mix-panel">
        <div className="panel-heading">
          <h2>Event distribution</h2>
          <span>{all.length} total</span>
        </div>
        <div
          className="segmented-chart"
          role="img"
          aria-label={kinds
            .map(
              ([kind, label]) =>
                `${label}: ${all.filter((e) => e.event_type === kind).length}`,
            )
            .join(", ")}
        >
          {kinds.map(([kind, label], i) => {
            const count = all.filter((e) => e.event_type === kind).length;
            return count ? (
              <span
                key={kind}
                className={`segment segment-${i}`}
                style={{ flex: count }}
              >
                <span className="chart-tooltip">
                  {label}: {count}
                </span>
              </span>
            ) : null;
          })}
          {!all.length ? <span className="segment-empty" /> : null}
        </div>
        <div className="mix-legend">
          {kinds.map(([kind, label], i) => (
            <div key={kind}>
              <i className={`segment-${i}`} />
              <span>
                {label}
                <small>
                  {all.filter((e) => e.event_type === kind).length} events
                </small>
              </span>
            </div>
          ))}
        </div>
      </section>
      <section className="panel flags-chart">
        <div className="panel-heading">
          <h2>Review flags</h2>
          <span>{ranked.length} types</span>
        </div>
        {ranked.length ? (
          ranked.map(([flag, count], i) => (
            <div className="flag-bar" key={flag}>
              <div>
                <span>{flag.replaceAll("_", " ")}</span>
                <small>{count}</small>
              </div>
              <div className="flag-track">
                <span
                  className={`flag-color-${i}`}
                  style={{
                    width: `${(count / Math.max(1, all.length)) * 100}%`,
                  }}
                />
              </div>
            </div>
          ))
        ) : (
          <div className="mini-empty">
            <Icon name="check" size={25} />
            <span>No flags</span>
          </div>
        )}
      </section>
      <section className="panel quick-panel">
        <div className="panel-heading">
          <h2>Quick actions</h2>
        </div>
        <div className="quick-grid">
          {[
            ["mic", "New note", onCapture],
            ["patients", "Patients", onPatients],
            ["records", "Records", onRecords],
            ["check", "Review", onReview],
          ].map(([icon, label, action]) => (
            <button
              key={String(label)}
              onClick={action as () => void}
              disabled={label === "Review" && !all.length}
            >
              <Icon name={String(icon)} size={22} />
              <span>{String(label)}</span>
            </button>
          ))}
        </div>
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
  const [hovered, setHovered] = useState<Point | null>(null);
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
  const tickIndexes = new Set([
    0,
    ...[0.25, 0.5, 0.75].map((n) => Math.round((points.length - 1) * n)),
    points.length - 1,
  ]);
  const multipleDays = points.some(
    (p) => p.time.slice(0, 10) !== points[0].time.slice(0, 10),
  );
  const line = (secondary = false) =>
    points
      .map((p, i) => `${x(i)},${y(secondary ? p.secondary! : p.value)}`)
      .join(" ");
  return (
    <>
      <div className="chart-canvas">
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
            <polyline
              points={line(true)}
              className="chart-line secondary-line"
            />
          ) : null}
          {points.map((p, i) => (
            <g key={`${p.time}-${i}`}>
              <circle
                cx={x(i)}
                cy={y(p.value)}
                r="4.5"
                className="chart-dot"
                tabIndex={0}
                onPointerEnter={() => setHovered(p)}
                onPointerLeave={() => setHovered(null)}
                onFocus={() => setHovered(p)}
                onBlur={() => setHovered(null)}
                aria-label={`${p.label}: ${p.value} ${p.unit}`}
              ></circle>
              {p.secondary !== undefined ? (
                <circle
                  cx={x(i)}
                  cy={y(p.secondary)}
                  r="4"
                  className="chart-dot secondary-dot"
                  tabIndex={0}
                  onPointerEnter={() => setHovered(p)}
                  onPointerLeave={() => setHovered(null)}
                  onFocus={() => setHovered(p)}
                  onBlur={() => setHovered(null)}
                  aria-label={`${p.label}: diastolic ${p.secondary} ${p.unit}`}
                ></circle>
              ) : null}
              {tickIndexes.has(i) ? (
                <text x={x(i)} y="208" textAnchor="middle">
                  {multipleDays ? p.time.slice(5, 10) : p.time.slice(11, 16)}
                </text>
              ) : null}
            </g>
          ))}
        </svg>
        {hovered ? (
          <div className="reading-tooltip">
            <span>{hovered.label}</span>
            <strong>
              {hovered.value}
              {hovered.secondary !== undefined
                ? `/${hovered.secondary}`
                : ""}{" "}
              {hovered.unit}
            </strong>
          </div>
        ) : null}
      </div>
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
