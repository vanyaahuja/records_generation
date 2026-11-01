import { Icon } from "./Icons";
import { Select } from "./Controls";
import { memo } from "react";
import type { Event } from "./state";

type Props = {
  expanded?: boolean;
  event: Event;
  index: number;
  update: (index: number, patch: Partial<Event>) => void;
  remove: (index: number) => void;
  select: (value: [number, number]) => void;
};
function EventCard({
  event: e,
  index,
  update,
  remove,
  select,
  expanded = false,
}: Props) {
  const change = (key: keyof Event, value: unknown) =>
    update(index, {
      [key]: value,
      review_status: "needs_human_confirmation",
      accepted_flags: [],
    });
  const showEvidence = (key: string) => {
    const span = e.fields[key]?.evidence;
    if (span) select([e.source_offset + span[0], e.source_offset + span[1]]);
  };
  const unresolved = e.flags.filter((flag) => !e.accepted_flags.includes(flag));
  return (
    <article
      className={`event-card ${e.review_status !== "needs_human_confirmation" ? "reviewed" : ""}`}
    >
      <div className="event-heading">
        <span className="event-number">
          {String(index + 1).padStart(2, "0")}
        </span>
        <strong>{e.medication || e.description}</strong>
        <span className={`badge status-chip status-${e.action_status}`}>
          {e.action_status.replaceAll("_", " ")}
        </span>
        <button
          className="link danger"
          onClick={() => remove(index)}
          aria-label={`Remove event ${index + 1}`}
        >
          Remove
        </button>
      </div>
      <div className="event-summary">
        <span>{e.event_time || "Time not documented"}</span>
        <span>
          {e.event_type === "medication_administration" ? (
            <>
              {e.dose?.value == null ? (
                <span className="missing-chip">Missing dose</span>
              ) : (
                `${e.dose.value} ${e.dose.unit || ""}`
              )}{" "}
              · {e.route || <span className="missing-chip">Missing route</span>}
            </>
          ) : e.observation ? (
            Object.entries(e.observation)
              .filter(([key]) => key !== "type")
              .map(([, value]) => String(value))
              .join(" / ")
          ) : (
            e.event_type.replaceAll("_", " ")
          )}
        </span>
      </div>
      <details className="event-details" open={expanded || index === 0}>
        <summary>Edit fields & inspect evidence</summary>
        <div className="form-grid three">
          <label>
            Event type
            <Select
              aria-label="Event type"
              value={e.event_type}
              onChange={(x) => change("event_type", x.target.value)}
            >
              <option value="medication_administration">Medication</option>
              <option value="procedure">Procedure</option>
              <option value="observation">Observation</option>
              <option value="unclassified">Unclassified</option>
            </Select>
          </label>
          <label>
            Action status
            <Select
              aria-label="Action status"
              value={e.status}
              onChange={(x) => change("status", x.target.value)}
            >
              <option value="reported">Reported performed</option>
              <option value="negated">Not performed</option>
              <option value="uncertain">Uncertain</option>
              <option value="needs_review">Needs review</option>
            </Select>
          </label>
          <label htmlFor={`${e.event_id}-time`}>
            Reported time{" "}
            <button
              aria-label="Source"
              className="evidence"
              onClick={() => showEvidence("event_time")}
              type="button"
            >
              <Icon name="source" size={14} />
            </button>
            <input
              id={`${e.event_id}-time`}
              aria-label={`Event ${index + 1} time`}
              placeholder="Unknown · HH:MM"
              value={e.event_time || ""}
              onChange={(x) => change("event_time", x.target.value || null)}
            />
          </label>
        </div>
        <label htmlFor={`${e.event_id}-description`}>
          Description{" "}
          <button
            aria-label="Source"
            className="evidence"
            onClick={() => showEvidence("description")}
            type="button"
          >
            <Icon name="source" size={14} />
          </button>
          <input
            id={`${e.event_id}-description`}
            value={e.description}
            onChange={(x) => change("description", x.target.value)}
          />
        </label>
        {e.event_type === "medication_administration" ? (
          <>
            <label htmlFor={`${e.event_id}-medication`}>
              Medication{" "}
              <button
                aria-label="Source"
                className="evidence"
                onClick={() => showEvidence("medication")}
                type="button"
              >
                <Icon name="source" size={14} />
              </button>
              <input
                id={`${e.event_id}-medication`}
                value={e.medication || ""}
                onChange={(x) => change("medication", x.target.value || null)}
              />
            </label>
            <div className="form-grid three">
              <label htmlFor={`${e.event_id}-dose`}>
                Dose{" "}
                <button
                  aria-label="Source"
                  className="evidence"
                  onClick={() => showEvidence("dose")}
                  type="button"
                >
                  <Icon name="source" size={14} />
                </button>
                <input
                  id={`${e.event_id}-dose`}
                  type="number"
                  min="0"
                  step="any"
                  value={e.dose?.value ?? ""}
                  onChange={(x) =>
                    change("dose", {
                      ...(e.dose || {}),
                      value:
                        x.target.value === "" ? null : Number(x.target.value),
                    })
                  }
                />
              </label>
              <label>
                Unit
                <input
                  value={e.dose?.unit || ""}
                  onChange={(x) =>
                    change("dose", {
                      ...(e.dose || {}),
                      unit: x.target.value || null,
                    })
                  }
                />
              </label>
              <label htmlFor={`${e.event_id}-route`}>
                Route{" "}
                <button
                  aria-label="Source"
                  className="evidence"
                  onClick={() => showEvidence("route")}
                  type="button"
                >
                  <Icon name="source" size={14} />
                </button>
                <input
                  id={`${e.event_id}-route`}
                  value={e.route || ""}
                  onChange={(x) => change("route", x.target.value || null)}
                />
              </label>
            </div>
          </>
        ) : null}
        {e.event_type === "observation" ? (
          <div className="observation-fields">
            <label>
              Observation type
              <Select
                aria-label="Observation type"
                value={String(e.observation?.type || "")}
                onChange={(x) =>
                  change("observation", { type: x.target.value })
                }
              >
                <option value="">Select a type</option>
                <option value="blood_pressure">Blood pressure</option>
                <option value="heart_rate">Heart rate</option>
                <option value="spo2">Oxygen saturation</option>
                <option value="respiratory_rate">Respiratory rate</option>
                <option value="temperature">Temperature</option>
              </Select>
            </label>
            <button
              aria-label="Source"
              className="evidence"
              onClick={() => showEvidence("observation")}
              type="button"
            >
              <Icon name="source" size={14} />
            </button>
            <div className="form-grid three">
              {(e.observation?.type === "blood_pressure"
                ? ["systolic", "diastolic"]
                : ["value"]
              ).map((key) => (
                <label key={key}>
                  {key === "value"
                    ? "Value"
                    : key === "systolic"
                      ? "Systolic"
                      : "Diastolic"}
                  <input
                    type="number"
                    step="any"
                    value={
                      typeof e.observation?.[key] === "number"
                        ? (e.observation[key] as number)
                        : ""
                    }
                    onChange={(x) =>
                      change("observation", {
                        ...e.observation,
                        [key]:
                          x.target.value === "" ? null : Number(x.target.value),
                      })
                    }
                  />
                </label>
              ))}
              <label>
                Unit
                <input
                  placeholder="Not documented"
                  value={String(e.observation?.unit || "")}
                  onChange={(x) =>
                    change("observation", {
                      ...e.observation,
                      unit: x.target.value || null,
                    })
                  }
                />
              </label>
            </div>
          </div>
        ) : null}
        <div className="source-snippet">
          <span>Original words</span>
          <button
            onClick={() =>
              select([
                e.source_offset,
                e.source_offset + Array.from(e.source_text).length,
              ])
            }
          >
            {e.source_text}
          </button>
        </div>
      </details>
      {e.flags.length ? (
        <div className="flags">
          <strong>Review required</strong>
          <div>
            {e.flags.map((flag) => (
              <span className="flag" key={flag}>
                {flag.replaceAll("_", " ")}
              </span>
            ))}
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={!unresolved.length}
              onChange={(x) =>
                update(index, {
                  accepted_flags: x.target.checked ? [...e.flags] : [],
                  review_status: "needs_human_confirmation",
                })
              }
            />
            I reviewed these flags. Missing values remain not documented;
            uncertainty is accepted.
          </label>
        </div>
      ) : null}
      <div className="event-footer">
        <span>
          {e.review_status === "needs_human_confirmation"
            ? "Awaiting review"
            : "Accepted by reviewer"}
        </span>
        <button
          className="secondary compact"
          disabled={!!unresolved.length}
          onClick={() =>
            update(index, {
              review_status: e.manual ? "corrected" : "confirmed",
            })
          }
        >
          {e.review_status === "needs_human_confirmation"
            ? "Accept event"
            : "Accepted"}
        </button>
      </div>
    </article>
  );
}
export default memo(EventCard);
