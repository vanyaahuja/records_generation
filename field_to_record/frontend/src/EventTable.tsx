import { useState } from "react";
import { Icon } from "./Icons";
import { IconAction } from "./Controls";
import EventCard from "./EventCard";
import type { Event } from "./state";

function details(event: Event) {
  const obs = event.observation;
  if (event.event_type === "medication_administration")
    return `${event.dose?.value ?? "—"} ${event.dose?.unit || ""} · ${event.route || "—"}`;
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

export default function EventTable({
  events,
  visible,
  update,
  remove,
  select,
}: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const selected = events.findIndex((event) => event.event_id === editing);
  return (
    <div className="event-review">
      <section className="panel event-table-panel">
        <div className="event-table-scroll">
          <table aria-label="Recorded events">
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Event</th>
                <th scope="col">Reading / details</th>
                <th scope="col">Action</th>
                <th scope="col">Review</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(({ event, index }) => {
                const unresolved = event.flags.filter(
                  (flag) => !event.accepted_flags.includes(flag),
                );
                const reviewed =
                  event.review_status !== "needs_human_confirmation";
                return (
                  <tr
                    key={event.event_id}
                    className="event-row"
                    data-event-index={index}
                  >
                    <td className="event-time">{event.event_time || "—"}</td>
                    <td>
                      <strong>{event.medication || event.description}</strong>
                      <small>{event.event_type.replaceAll("_", " ")}</small>
                    </td>
                    <td className="event-value">
                      {details(event)}
                      {event.flags.length ? (
                        <div className="entry-flags">
                          {event.flags.map((flag) => (
                            <span className="missing-chip" key={flag}>
                              {flag.replaceAll("_", " ")}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <span
                        className={`badge status-chip status-${event.action_status}`}
                      >
                        {event.action_status.replaceAll("_", " ")}
                      </span>
                    </td>
                    <td>
                      <button
                        className={`event-accept ${reviewed ? "is-accepted" : ""}`}
                        disabled={reviewed || !!unresolved.length}
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
                        <details className="event-row-flags">
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
                                    review_status: "needs_human_confirmation",
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
                      <div className="event-tools">
                        <IconAction
                          icon="source"
                          label={`Source event ${index + 1}`}
                          onClick={() =>
                            select([
                              event.source_offset,
                              event.source_offset +
                                Array.from(event.source_text).length,
                            ])
                          }
                        />
                        <IconAction
                          icon="edit"
                          label={`Edit event ${index + 1}`}
                          onClick={() => setEditing(event.event_id)}
                        />
                        <IconAction
                          icon="delete"
                          label={`Delete event ${index + 1}`}
                          onClick={() => remove(index)}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!visible.length ? (
                <tr className="event-empty">
                  <td colSpan={6}>No matching events</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
      {selected >= 0 ? (
        <div className="dialog-backdrop event-editor-backdrop">
          <section
            className="event-editor panel"
            role="dialog"
            aria-modal="true"
            aria-label="Edit event entry"
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
