import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { api } from "./api";
import { IconAction, Select } from "./Controls";
import { Icon } from "./Icons";

function ActionPopover({
  label,
  icon,
  disabled,
  children,
}: {
  label: string;
  icon: string;
  disabled: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [highlight, setHighlight] = useState<{
    top: number;
    height: number;
  } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null),
    popup = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = (focus = false) => {
    setOpen(false);
    if (focus) trigger.current?.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const box = trigger.current?.getBoundingClientRect(),
        menu = popup.current;
      if (!box || !menu) return;
      const height = menu.offsetHeight;
      setPosition({
        left: Math.max(
          8,
          Math.min(box.left, innerWidth - menu.offsetWidth - 8),
        ),
        top:
          box.bottom + height + 12 > innerHeight && box.top > height
            ? box.top - height - 8
            : Math.min(box.bottom + 8, Math.max(8, innerHeight - height - 8)),
      });
    };
    place();
    popup.current
      ?.querySelector<HTMLElement>('[role="menuitem"]')
      ?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (
        !trigger.current?.contains(event.target as Node) &&
        !popup.current?.contains(event.target as Node)
      )
        close();
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);
  return (
    <>
      <button
        ref={trigger}
        className="record-menu-trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Icon name={icon} size={16} />
        {label === "Record actions"
          ? "More"
          : label === "Export record"
            ? "Export"
            : label}
        <Icon name="chevron" size={13} />
      </button>
      {open
        ? createPortal(
            <div
              ref={popup}
              id={id}
              className="record-action-popover"
              role="menu"
              aria-label={label}
              style={position}
              onPointerMove={(event) => {
                const item = (event.target as Element).closest<HTMLElement>(
                  '[role="menuitem"]',
                );
                if (item)
                  setHighlight({
                    top: item.offsetTop,
                    height: item.offsetHeight,
                  });
              }}
              onFocusCapture={(event) => {
                const item = (event.target as Element).closest<HTMLElement>(
                  '[role="menuitem"]',
                );
                if (item)
                  setHighlight({
                    top: item.offsetTop,
                    height: item.offsetHeight,
                  });
              }}
              onClick={(event) => {
                if ((event.target as Element).closest('[role="menuitem"]'))
                  close(true);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape" || event.key === "Tab") {
                  event.preventDefault();
                  event.stopPropagation();
                  close(true);
                  return;
                }
                if (
                  !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
                )
                  return;
                event.preventDefault();
                const items = Array.from(
                  event.currentTarget.querySelectorAll<HTMLElement>(
                    '[role="menuitem"]',
                  ),
                );
                const index = items.indexOf(
                  document.activeElement as HTMLElement,
                );
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? items.length - 1
                      : (index +
                          (event.key === "ArrowDown" ? 1 : -1) +
                          items.length) %
                        items.length;
                items[next]?.focus();
              }}
            >
              {highlight ? (
                <span
                  className="record-menu-hover"
                  aria-hidden="true"
                  style={{
                    height: highlight.height,
                    transform: `translateY(${highlight.top}px)`,
                  }}
                />
              ) : null}
              {children}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

type Revision = { version: number; actor: string; created_at: string };
type Props = {
  recordId: string;
  version: number;
  revisions: Revision[];
  busy: boolean;
  onRevision: (version: number) => void;
  notify: (message: string) => void;
};
export default function RecordMenu({
  recordId,
  version,
  revisions,
  busy,
  onRevision,
  notify,
}: Props) {
  const [panel, setPanel] = useState<"preview" | "original" | null>(null);
  const [content, setContent] = useState("");
  const [audit, setAudit] = useState<{
    valid: boolean;
    message: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), [recordId, version]);
  async function run(action: "preview" | "audit" | "original") {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    try {
      if (action === "audit") {
        const result = await api<{ valid: boolean }>("/api/audit/verify", {
          signal: controller.signal,
        });
        if (!controller.signal.aborted)
          setAudit({
            valid: result.valid,
            message: result.valid
              ? "Verified · audit chain intact"
              : "Audit verification failed",
          });
      } else {
        let text: string;
        if (action === "preview") {
          const response = await fetch(
            `/api/records/${recordId}/html?version=${version}`,
            { signal: controller.signal },
          );
          if (!response.ok) throw new Error("Could not load note preview.");
          text = await response.text();
        } else
          text = JSON.stringify(
            await api(`/api/records/${recordId}/original`, {
              signal: controller.signal,
            }),
            null,
            2,
          );
        if (!controller.signal.aborted) {
          setContent(text);
          setPanel(action);
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) notify((error as Error).message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  const latest = Math.max(
    version,
    ...revisions.map((revision) => revision.version),
  );
  const current = revisions.find((revision) => revision.version === version);
  const disabled = busy || loading;
  return (
    <section className="panel exports record-panel" aria-label="Record menu">
      <div className="record-menu-header">
        <div className="record-menu-identity">
          <span className="record-menu-icon">
            <Icon name="records" size={22} />
          </span>
          <div>
            <h2>Record history</h2>
            <p className="mono">
              {recordId} · revision {version}
            </p>
          </div>
        </div>
        <div className="record-menu-version">
          <span className="record-local">
            <i />
            Saved locally
          </span>
          <Select
            aria-label="Record revision"
            value={String(version)}
            disabled={disabled}
            onChange={(event) => onRevision(Number(event.target.value))}
          >
            {[...revisions]
              .sort((a, b) => b.version - a.version)
              .map((revision) => (
                <option key={revision.version} value={String(revision.version)}>
                  Revision {revision.version}
                  {revision.version === latest ? " · Latest" : ""} ·{" "}
                  {revision.actor}
                </option>
              ))}
          </Select>
        </div>
      </div>
      <div className="record-menu-toolbar">
        <div className="record-menu-actions">
          <button
            className="record-preview-button"
            aria-label="Preview note"
            onClick={() => void run("preview")}
            disabled={disabled}
          >
            <Icon name="records" size={16} />
            Preview
          </button>
          <ActionPopover
            key={`exports-${recordId}-${version}`}
            label="Export record"
            icon="arrow"
            disabled={disabled}
          >
            <div className="record-menu-caption">Export revision {version}</div>
            {[
              ["pdf", "PDF"],
              ["json", "JSON"],
              ["fhir", "FHIR-lite"],
              ["html", "HTML"],
              ["text", "TEXT"],
            ].map(([format, label]) => (
              <a
                role="menuitem"
                tabIndex={-1}
                key={format}
                href={`/api/records/${recordId}/${format}?version=${version}`}
                target="_blank"
                rel="noreferrer"
              >
              <span className="record-file-format" aria-hidden="true">
                  {format === "fhir"
                    ? "FHIR"
                    : format === "text"
                      ? "TXT"
                      : label}
                </span>
                <span>{label}</span>
                <Icon name="arrow" size={14} />
              </a>
            ))}
          </ActionPopover>
          <ActionPopover
            key={`actions-${recordId}-${version}`}
            label="Record actions"
            icon="shield"
            disabled={disabled}
          >
            <div className="record-menu-caption">Record tools</div>
            <button
              role="menuitem"
              tabIndex={-1}
              onClick={() => void run("audit")}
            >
              <Icon name="shield" size={17} />
              <span>Verify audit chain</span>
              <Icon name="check" size={14} />
            </button>
            <button
              role="menuitem"
              tabIndex={-1}
              onClick={() => void run("original")}
            >
              <Icon name="source" size={17} />
              <span>Original extraction</span>
              <Icon name="arrow" size={14} />
            </button>
          </ActionPopover>
        </div>
        <span className="record-revision-detail">
          {loading ? "Loading…" : current?.actor}
          {version < latest ? (
            <span className="badge">Earlier revision</span>
          ) : null}
        </span>
      </div>
      {audit ? (
        <p
          className={`record-audit-result ${audit.valid ? "is-valid" : "is-invalid"}`}
          role="status"
        >
          <Icon name={audit.valid ? "shield" : "close"} size={15} />
          {audit.message}
        </p>
      ) : null}
      {panel ? (
        <section className="record-detail-panel">
          <header>
            <h3>
              {panel === "preview" ? "Note preview" : "Original extraction"}
            </h3>
            <IconAction
              icon="close"
              label="Close record details"
              onClick={() => {
                setPanel(null);
                setContent("");
              }}
            />
          </header>
          {panel === "preview" ? (
            <iframe title="Handover preview" sandbox="" srcDoc={content} />
          ) : (
            <pre>{content}</pre>
          )}
        </section>
      ) : null}
    </section>
  );
}
