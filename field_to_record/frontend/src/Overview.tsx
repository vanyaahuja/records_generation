import { useEffect, useState } from "react";
import { api } from "./api";
import { FloatingTip, Select } from "./Controls";
import { Icon } from "./Icons";

const categories = [
  ["medication_administration", "Medication", "var(--chart-violet)"],
  ["procedure", "Procedures", "var(--chart-blue)"],
  ["observation", "Observations", "var(--chart-teal)"],
  ["unclassified", "Other", "var(--chart-amber)"],
] as const;
type Day = {
  date: string;
  patients: number;
  records: number;
  events: number;
  pending_events: number;
  medication_administration: number;
  procedure: number;
  observation: number;
  unclassified: number;
};
export type WorkspaceSummary = {
  totals: {
    patients: number;
    records: number;
    events: number;
    accepted_events: number;
    pending_events: number;
    reviewed_records: number;
    pending_records: number;
  };
  daily: Day[];
  event_types: Record<string, number>;
  flags: Record<string, number>;
  recent_records: {
    record_id: string;
    case_id: string;
    event_count: number;
    encounter_date: string;
    record_status: string;
    patient: { name: string; patient_id: string } | null;
  }[];
  days: number;
  start_date: string;
  end_date: string;
};
type Tip = { anchor: Element; date: string; label: string } | null;
const shortDate = (date: string) =>
  new Date(date + "T12:00:00").toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

function ActivityBars({ rows }: { rows: Day[] }) {
  const [tip, setTip] = useState<Tip>(null);
  const max = Math.max(1, ...rows.map((row) => row.events));
  const band = 620 / rows.length;
  return (
    <>
      <svg
        className="overview-chart"
        viewBox="0 0 700 240"
        role="img"
        aria-label="Daily events by category"
      >
        {[0, 0.5, 1].map((n) => (
          <g key={n}>
            <line
              className="chart-grid"
              x1="48"
              x2="680"
              y1={200 - n * 170}
              y2={200 - n * 170}
            />
            <text x="37" y={204 - n * 170} textAnchor="end">
              {Math.round(n * max)}
            </text>
          </g>
        ))}
        {rows.map((row, index) => {
          let bottom = 200;
          return (
            <g key={row.date}>
              <g
                className="overview-column"
                tabIndex={0}
                aria-label={`${row.date}: ${row.events} events`}
                onPointerEnter={(e) =>
                  setTip({
                    anchor: e.currentTarget,
                    date: row.date,
                    label: `${row.events} events · ${row.records} notes`,
                  })
                }
                onPointerLeave={() => setTip(null)}
                onFocus={(e) =>
                  setTip({
                    anchor: e.currentTarget,
                    date: row.date,
                    label: `${row.events} events · ${row.records} notes`,
                  })
                }
                onBlur={() => setTip(null)}
              >
                <rect
                  x={52 + index * band}
                  y={200 - Math.max(5, (row.events / max) * 170)}
                  width={band * 0.65}
                  height={Math.max(5, (row.events / max) * 170)}
                  fill="transparent"
                />
                {categories.map(([key, , color]) => {
                  const height = (row[key] / max) * 170;
                  bottom -= height;
                  return (
                    <rect
                      key={key}
                      x={52 + index * band}
                      y={bottom}
                      width={band * 0.65}
                      height={height}
                      rx="2"
                      fill={color}
                    />
                  );
                })}
              </g>
              {index === 0 ||
              index === rows.length - 1 ||
              index % Math.max(1, Math.ceil(rows.length / 6)) === 0 ? (
                <text
                  x={52 + index * band + band * 0.325}
                  y="226"
                  textAnchor="middle"
                >
                  {shortDate(row.date)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {tip ? (
        <FloatingTip anchor={tip.anchor} className="reading-tooltip">
          <span>{shortDate(tip.date)}</span>
          <strong>{tip.label}</strong>
        </FloatingTip>
      ) : null}
      <div className="overview-legend">
        {categories.map(([key, label, color]) => (
          <span key={key}>
            <i style={{ background: color }} />
            {label}
          </span>
        ))}
      </div>
    </>
  );
}

function RegistrationTrend({ rows }: { rows: Day[] }) {
  const [tip, setTip] = useState<Tip>(null);
  const max = Math.max(
    1,
    ...rows.flatMap((row) => [row.records, row.patients]),
  );
  const x = (i: number) => 50 + (i / (rows.length - 1)) * 620;
  const y = (n: number) => 175 - (n / max) * 145;
  return (
    <>
      <svg
        className="overview-chart trend-chart"
        viewBox="0 0 700 215"
        role="img"
        aria-label="Patient registrations and notes by encounter date"
      >
        {[0, 0.5, 1].map((n) => (
          <g key={n}>
            <line
              className="chart-grid"
              x1="48"
              x2="680"
              y1={175 - n * 145}
              y2={175 - n * 145}
            />
            <text x="37" y={179 - n * 145} textAnchor="end">
              {Math.round(n * max)}
            </text>
          </g>
        ))}
        <polyline
          className="overview-trend-line"
          points={rows.map((r, i) => `${x(i)},${y(r.patients)}`).join(" ")}
          style={{ stroke: "var(--chart-blue)" }}
        />
        <polyline
          className="overview-trend-line notes-line"
          points={rows.map((r, i) => `${x(i)},${y(r.records)}`).join(" ")}
          style={{ stroke: "var(--chart-violet)" }}
        />
        {rows.map((row, i) => (
          <g key={row.date}>
            {["patients", "records"].map((key) => (
              <circle
                key={key}
                cx={x(i)}
                cy={y(row[key as "patients" | "records"])}
                r="3.5"
                fill={
                  key === "patients"
                    ? "var(--chart-blue)"
                    : "var(--chart-violet)"
                }
                tabIndex={0}
                aria-label={`${row.date}: ${row.patients} patients, ${row.records} notes`}
                onPointerEnter={(e) =>
                  setTip({
                    anchor: e.currentTarget,
                    date: row.date,
                    label: `${row.patients} patients · ${row.records} notes`,
                  })
                }
                onPointerLeave={() => setTip(null)}
                onFocus={(e) =>
                  setTip({
                    anchor: e.currentTarget,
                    date: row.date,
                    label: `${row.patients} patients · ${row.records} notes`,
                  })
                }
                onBlur={() => setTip(null)}
              />
            ))}
            {i === 0 ||
            i === rows.length - 1 ||
            i % Math.max(1, Math.ceil(rows.length / 6)) === 0 ? (
              <text x={x(i)} y="204" textAnchor="middle">
                {shortDate(row.date)}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
      <div className="overview-legend">
        <span>
          <i style={{ background: "var(--chart-blue)" }} />
          Patients registered
        </span>
        <span>
          <i style={{ background: "var(--chart-violet)" }} />
          Notes by encounter
        </span>
      </div>
      {tip ? (
        <FloatingTip anchor={tip.anchor} className="reading-tooltip">
          <span>{shortDate(tip.date)}</span>
          <strong>{tip.label}</strong>
        </FloatingTip>
      ) : null}
    </>
  );
}

export default function Overview({
  onOpen,
  onCapture,
}: {
  onOpen: (id: string) => void;
  onCapture: () => void;
}) {
  const [days, setDays] = useState("30");
  const [data, setData] = useState<WorkspaceSummary | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setData(null);
    const end = new Date().toLocaleDateString("en-CA");
    api<WorkspaceSummary>(`/api/dashboard?days=${days}&end_date=${end}`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [days, refresh]);
  const total = data?.totals;
  const accepted = total?.accepted_events || 0,
    pending = total?.pending_events || 0;
  const percent = total?.events
    ? Math.round((accepted / total.events) * 100)
    : 0;
  return (
    <div className="workspace-overview" aria-label="Overall dashboard">
      <div className="page-intro">
        <div>
          <h1>Overview</h1>
          <p>All patients. All saved records.</p>
        </div>
        <div className="overview-actions">
          <Select
            aria-label="Overview date range"
            value={days}
            onChange={(e) => setDays(e.target.value)}
          >
            {[7, 14, 30, 90].map((n) => (
              <option key={n} value={String(n)}>
                Last {n} days
              </option>
            ))}
          </Select>
          <button className="primary" onClick={onCapture}>
            <Icon name="plus" size={17} />
            Capture note
          </button>
        </div>
      </div>
      {error ? (
        <section className="panel empty-state">
          <h2>Couldn’t load overview</h2>
          <p>{error}</p>
          <button onClick={() => setRefresh((n) => n + 1)}>Try again</button>
        </section>
      ) : !data ? (
        <div className="overview-skeleton" aria-label="Loading overview">
          {[0, 1, 2, 3, 4, 5].map((n) => (
            <div key={n} />
          ))}
        </div>
      ) : (
        <>
          <div className="stats-row overview-stats">
            {[
              ["Patients", total!.patients, "patients", "patients"],
              ["Saved records", total!.records, "records", "records"],
              ["Recorded events", total!.events, "events", "pulse"],
              [
                "Awaiting review",
                total!.pending_events,
                "pending_events",
                "clock",
              ],
            ].map(([label, value, key, icon]) => (
              <section className="stat-card" key={label}>
                <span className="stat-label">
                  {label}
                  <Icon name={String(icon)} size={18} />
                </span>
                <strong className="stat-value">
                  {Number(value).toLocaleString()}
                </strong>
                <small className="overview-total-label">All time</small>
                <svg
                  className="stat-sparkline"
                  width="60"
                  height="30"
                  viewBox="0 0 60 30"
                  aria-hidden="true"
                >
                  {data.daily.slice(-8).map((row, j, subset) => {
                    const metric = key as
                      "patients" | "records" | "events" | "pending_events";
                    const h =
                      (row[metric] /
                        Math.max(1, ...subset.map((r) => r[metric]))) *
                      27;
                    return (
                      <rect
                        key={row.date}
                        x={j * 7}
                        y={30 - h}
                        width="5"
                        height={h}
                        rx="1.5"
                      />
                    );
                  })}
                </svg>
              </section>
            ))}
          </div>
          <div className="overview-grid" key={days}>
            <section className="panel overview-events">
              <div className="panel-heading">
                <div>
                  <h2>Recorded activity</h2>
                  <small>
                    {shortDate(data.start_date)} – {shortDate(data.end_date)}
                  </small>
                </div>
                <span>
                  {data.daily
                    .reduce((n, r) => n + r.events, 0)
                    .toLocaleString()}{" "}
                  events
                </span>
              </div>
              <ActivityBars rows={data.daily} />
            </section>
            <section className="panel overview-review">
              <div className="panel-heading">
                <h2>Review progress</h2>
                <span>All time</span>
              </div>
              <div className="overview-ring">
                <svg
                  viewBox="0 0 180 180"
                  role="img"
                  aria-label={`${percent}% of events accepted`}
                >
                  <circle
                    cx="90"
                    cy="90"
                    r="68"
                    pathLength="100"
                    fill="none"
                    stroke="var(--input)"
                    strokeWidth="13"
                  />
                  <circle
                    className="review-ring-progress"
                    cx="90"
                    cy="90"
                    r="68"
                    pathLength="100"
                    fill="none"
                    stroke="var(--chart-teal)"
                    strokeWidth="13"
                    strokeLinecap="round"
                    strokeDasharray={`${total!.events ? (accepted / total!.events) * 100 : 0} 100`}
                    transform="rotate(-90 90 90)"
                  />
                </svg>
                <div>
                  <strong>{percent}%</strong>
                  <span>Accepted</span>
                </div>
              </div>
              <div className="review-totals">
                <span>
                  <i />
                  {accepted.toLocaleString()} accepted
                </span>
                <span>
                  <i />
                  {pending.toLocaleString()} pending
                </span>
              </div>
              <small>
                {total!.reviewed_records} reviewed notes ·{" "}
                {total!.pending_records} drafts
              </small>
            </section>
            <section className="panel overview-growth">
              <div className="panel-heading">
                <h2>Patients & notes</h2>
                <span>Daily totals</span>
              </div>
              <RegistrationTrend rows={data.daily} />
            </section>
            <section className="panel overview-mix">
              <div className="panel-heading">
                <h2>Event mix</h2>
                <span>All time</span>
              </div>
              {categories.map(([key, label, color]) => (
                <div className="overview-mix-row" key={key}>
                  <div>
                    <span>
                      <i style={{ background: color }} />
                      {label}
                    </span>
                    <strong>
                      {(data.event_types[key] || 0).toLocaleString()}
                    </strong>
                  </div>
                  <div className="flag-track">
                    <span
                      style={{
                        width: `${((data.event_types[key] || 0) / Math.max(1, total!.events)) * 100}%`,
                        background: color,
                      }}
                    />
                  </div>
                </div>
              ))}
              <div className="overview-flag-note">
                <Icon name="shield" size={15} />
                {Object.keys(data.flags).length
                  ? `${Object.values(data.flags).reduce((a, b) => a + b, 0)} flags across ${Object.keys(data.flags).length} shown types`
                  : "No review flags"}
              </div>
            </section>
          </div>
          <section className="panel recent-records overview-recent">
            <div className="panel-heading">
              <h2>Recent records</h2>
              <span>Latest 6 updates</span>
            </div>
            {!data.recent_records.length ? (
              <div className="empty-state">
                <Icon name="records" />
                <h3>No saved records yet</h3>
              </div>
            ) : (
              <div className="table-scroll">
                <table aria-label="Workspace recent records">
                  <thead>
                    <tr>
                      <th>Patient</th>
                      <th>Case</th>
                      <th>Encounter</th>
                      <th>Events</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent_records.map((record) => (
                      <tr key={record.record_id}>
                        <td>
                          <strong>
                            {record.patient?.name || "Unassigned"}
                          </strong>
                          {record.patient ? (
                            <small>
                              {record.patient.patient_id.slice(0, 8)}
                            </small>
                          ) : null}
                        </td>
                        <td>{record.case_id}</td>
                        <td>{record.encounter_date}</td>
                        <td>{record.event_count}</td>
                        <td>
                          <span
                            className={`badge status-chip ${record.record_status === "reviewed" ? "status-completed" : "status-pending"}`}
                          >
                            {record.record_status === "reviewed"
                              ? "Reviewed"
                              : "Draft"}
                          </span>
                        </td>
                        <td>
                          <button
                            onClick={() => onOpen(record.record_id)}
                            className="link"
                          >
                            Open
                            <Icon name="arrow" size={15} />
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
      )}
    </div>
  );
}
