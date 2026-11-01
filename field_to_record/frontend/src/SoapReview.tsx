import { useMemo, useState } from "react";
import { Select } from "./Controls";
import { Icon } from "./Icons";
import EventCard from "./EventCard";
import type { Event } from "./state";

export const soapSections = [
  { code: "S", title: "Subjective" },
  { code: "O", title: "Objective" },
  { code: "A", title: "Assessment" },
  { code: "P", title: "Plan" },
] as const;
export function soapSection(event: Event): "S" | "O" | "A" | "P" | null {
  if (event.soap_section) return event.soap_section;
  const heading = event.source_text.match(
    /^\s*(subjective|objective|assessment|plan|[SOAP])\s*:\s*/i,
  );
  if (heading) return heading[1][0].toUpperCase() as "S" | "O" | "A" | "P";
  if (event.event_type === "observation") return "O";
  if (["medication_administration", "procedure"].includes(event.event_type))
    return "P";
  return /\b(?:patient|caregiver)\s+(?:reports|states|denies|describes|complains)\b/i.test(
    event.source_text,
  )
    ? "S"
    : null;
}
function details(event: Event) {
  const obs = event.observation;
  if (event.event_type === "medication_administration")
    return `${event.dose?.value ?? "Not documented"} ${event.dose?.unit || ""} · ${event.route || "Not documented"}`;
  if (obs)
    return obs.type === "blood_pressure"
      ? `${obs.systolic ?? "—"}/${obs.diastolic ?? "—"} ${obs.unit || ""}`
      : `${obs.value ?? "Not documented"} ${obs.unit || ""}`;
  return event.description;
}
type Props = {
  events: Event[];
  visible: { event: Event; index: number }[];
  update: (index: number, patch: Partial<Event>) => void;
  remove: (index: number) => void;
  select: (span: [number, number]) => void;
};
export default function SoapReview({
  events,
  visible,
  update,
  remove,
  select,
}: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const selected = events.findIndex((event) => event.event_id === editing);
  const groups = useMemo(
    () => [
      ...soapSections,
      ...(events.some((e) => !soapSection(e))
        ? [{ code: "", title: "Unassigned" }]
        : []),
    ],
    [events],
  );
  return (
    <div className="soap-review" aria-label="SOAP review">
      {groups.map((section) => {
        const rows = visible.filter(
          ({ event }) => (soapSection(event) || "") === section.code,
        );
        const total = events.filter(
          (event) => (soapSection(event) || "") === section.code,
        ).length;
        return (
          <section
            className="panel soap-group"
            key={section.code}
            aria-label={`${section.title} section`}
          >
            <header className="soap-heading">
              <div>
                <span className="soap-letter">{section.code || "—"}</span>
                <h2>{section.title}</h2>
                {section.code === "P" ? (
                  <span className="soap-caption">Documented care & plans</span>
                ) : null}
              </div>
              <span>
                {rows.length === total ? total : `${rows.length} / ${total}`}
              </span>
            </header>
            <div className="soap-table-scroll">
              <table aria-label={`${section.title} entries`}>
                <thead>
                  <tr>
                    <th scope="col">Time</th>
                    <th scope="col">Entry</th>
                    <th scope="col">Details</th>
                    <th scope="col">Action</th>
                    <th scope="col">Review</th>
                    <th scope="col">Tools</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ event, index }) => {
                    const unresolved = event.flags.filter(
                      (flag) => !event.accepted_flags.includes(flag),
                    );
                    const reviewed =
                      event.review_status !== "needs_human_confirmation";
                    return (
                      <tr
                        key={event.event_id}
                        className="soap-event-row"
                        data-event-index={index}
                      >
                        <td className="soap-time">{event.event_time || "—"}</td>
                        <td>
                          <strong>
                            {event.medication || event.description}
                          </strong>
                          <small>{event.event_type.replaceAll("_", " ")}</small>
                        </td>
                        <td className="soap-value">{details(event)}</td>
                        <td>
                          <span className="badge">
                            {event.action_status.replaceAll("_", " ")}
                          </span>
                        </td>
                        <td>
                          <button
                            className={`soap-accept ${reviewed ? "is-accepted" : ""}`}
                            disabled={
                              reviewed ||
                              !!unresolved.length ||
                              !soapSection(event)
                            }
                            onClick={() =>
                              update(index, {
                                review_status: event.manual
                                  ? "corrected"
                                  : "confirmed",
                              })
                            }
                          >
                            {reviewed ? (
                              <>
                                <Icon name="check" size={14} />
                                Accepted
                              </>
                            ) : (
                              "Accept"
                            )}
                          </button>
                          {event.flags.length ? (
                            <details className="soap-row-flags">
                              <summary>{event.flags.length} flags</summary>
                              <div>
                                {event.flags.map((flag) => (
                                  <span className="flag" key={flag}>
                                    {flag.replaceAll("_", " ")}
                                  </span>
                                ))}
                                <label className="check">
                                  <input
                                    type="checkbox"
                                    aria-label={`Acknowledge flags for event ${index + 1}`}
                                    checked={!unresolved.length}
                                    onChange={(e) =>
                                      update(index, {
                                        accepted_flags: e.target.checked
                                          ? [...event.flags]
                                          : [],
                                        review_status:
                                          "needs_human_confirmation",
                                      })
                                    }
                                  />
                                  Reviewed uncertainty
                                </label>
                              </div>
                            </details>
                          ) : null}
                        </td>
                        <td>
                          <div className="soap-tools">
                            <button
                              aria-label={`Source event ${index + 1}`}
                              onClick={() =>
                                select([
                                  event.source_offset,
                                  event.source_offset +
                                    Array.from(event.source_text).length,
                                ])
                              }
                            >
                              Source
                            </button>
                            <button
                              aria-label={`Edit event ${index + 1}`}
                              onClick={() => setEditing(event.event_id)}
                            >
                              Edit
                            </button>
                          </div>
                          <Select
                            aria-label={`SOAP section for event ${index + 1}`}
                            value={soapSection(event) || ""}
                            onChange={(e) =>
                              update(index, {
                                soap_section: (e.target.value ||
                                  null) as Event["soap_section"],
                                review_status: "needs_human_confirmation",
                                accepted_flags: [],
                              })
                            }
                          >
                            <option value="">Auto / unassigned</option>
                            {soapSections.map((s) => (
                              <option key={s.code} value={s.code}>
                                {s.code} · {s.title}
                              </option>
                            ))}
                          </Select>
                        </td>
                      </tr>
                    );
                  })}
                  {!rows.length ? (
                    <tr className="soap-empty">
                      <td colSpan={6}>
                        {total ? "Hidden by filter" : "Not documented"}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
      {selected >= 0 ? (
        <div className="dialog-backdrop soap-editor-backdrop">
          <section
            className="soap-editor panel"
            role="dialog"
            aria-modal="true"
            aria-label="Edit SOAP entry"
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(null);
              if (e.key === "Tab") {
                const controls = e.currentTarget.querySelectorAll<HTMLElement>(
                  "button:not(:disabled),input:not(:disabled),textarea",
                );
                const first = controls[0],
                  last = controls[controls.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                  e.preventDefault();
                  last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault();
                  first.focus();
                }
              }
            }}
          >
            <header>
              <h2>Edit entry</h2>
              <button
                autoFocus
                className="icon-button"
                aria-label="Close editor"
                onClick={() => setEditing(null)}
              >
                <Icon name="close" />
              </button>
            </header>
            <EventCard
              expanded
              event={events[selected]}
              index={selected}
              update={(index, patch) => {
                update(index, patch);
                if (
                  patch.review_status &&
                  patch.review_status !== "needs_human_confirmation"
                )
                  setEditing(null);
              }}
              remove={(index) => {
                remove(index);
                setEditing(null);
              }}
              select={select}
            />
          </section>
        </div>
      ) : null}
    </div>
  );
}
