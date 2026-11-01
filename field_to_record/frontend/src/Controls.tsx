import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icons";

// Portals keep tooltips above sticky headers, dialogs and clipped chart panels.
export function FloatingTip({
  anchor,
  children,
  side = "top",
  className = "",
}: {
  anchor: Element;
  children: ReactNode;
  side?: "top" | "right";
  className?: string;
}) {
  const tip = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({
    left: 0,
    top: 0,
    visibility: "hidden" as "visible" | "hidden",
  });
  useLayoutEffect(() => {
    const place = () => {
      if (!tip.current || !anchor.isConnected) return;
      const box = anchor.getBoundingClientRect(),
        popup = tip.current.getBoundingClientRect();
      const left =
        side === "right"
          ? box.right + 10
          : box.left + box.width / 2 - popup.width / 2;
      const top =
        side === "right"
          ? box.top + box.height / 2 - popup.height / 2
          : box.top - popup.height - 12;
      setPosition({
        left: Math.max(8, Math.min(left, innerWidth - popup.width - 8)),
        top: Math.max(8, Math.min(top, innerHeight - popup.height - 8)),
        visibility:
          box.bottom > 0 && box.top < innerHeight ? "visible" : "hidden",
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, side, children]);
  if (!anchor.isConnected) return null;
  return createPortal(
    <div
      ref={tip}
      role="tooltip"
      className={`floating-tip ${className}`}
      style={position}
    >
      {children}
    </div>,
    document.body,
  );
}

function text(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) =>
      isValidElement<{ children?: ReactNode }>(child)
        ? text(child.props.children)
        : String(child),
    )
    .join("");
}
type Props = Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "onChange" | "value"
> & {
  value?: string;
  onChange?: (event: { target: { value: string } }) => void;
};
export function Select({
  value = "",
  onChange,
  children,
  disabled,
  className,
  "aria-label": label = "Select",
  ...props
}: Props) {
  const id = useId(),
    root = useRef<HTMLDivElement>(null),
    popup = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState(""),
    [active, setActive] = useState(0),
    [position, setPosition] = useState({
      left: 0,
      top: 0,
      width: 200,
      maxHeight: 280,
    });
  const options = useMemo(
    () =>
      Children.toArray(children).flatMap((child) => {
        if (
          !isValidElement<{
            value?: string;
            children?: ReactNode;
            disabled?: boolean;
          }>(child)
        )
          return [];
        const label = text(child.props.children);
        return [
          {
            value: child.props.value ?? label,
            label,
            disabled: !!child.props.disabled,
          },
        ];
      }),
    [children],
  );
  const visible = options.filter((option) =>
    option.label.toLowerCase().includes(search.toLowerCase()),
  );
  const selected = options.find((option) => option.value === value);
  const searchable = options.length > 8 || label === "Active patient";
  const close = (focus = false) => {
    setOpen(false);
    setSearch("");
    if (focus) trigger.current?.focus({ preventScroll: true });
  };
  const choose = (index: number) => {
    const option = visible[index];
    if (!option || option.disabled) return;
    onChange?.({ target: { value: option.value } });
    close(true);
  };
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const box = trigger.current?.getBoundingClientRect();
      if (!box) return;
      const height = Math.min(310, window.innerHeight - 24),
        below = window.innerHeight - box.bottom - 12;
      const above = below < 180 && box.top > below;
      setPosition({
        left: Math.max(
          8,
          Math.min(box.left, window.innerWidth - Math.max(box.width, 200) - 8),
        ),
        top: above ? Math.max(8, box.top - height - 6) : box.bottom + 6,
        width: Math.min(Math.max(box.width, 200), window.innerWidth - 16),
        maxHeight: above
          ? Math.min(height, box.top - 16)
          : Math.max(100, Math.min(height, below)),
      });
    }
    place();
    window.addEventListener("resize", place);
    const onScroll = (event: Event) => {
      if (!popup.current?.contains(event.target as Node)) place();
    };
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        !root.current?.contains(event.target as Node) &&
        !popup.current?.contains(event.target as Node)
      ) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => {
    if (open)
      document
        .getElementById(`${id}-${active}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, open, id]);
  const keys = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") {
      close();
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(
          Math.max(
            0,
            visible.findIndex((o) => o.value === value),
          ),
        );
      } else
        setActive((previous) =>
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? visible.length - 1
              : Math.max(
                  0,
                  Math.min(
                    visible.length - 1,
                    previous + (event.key === "ArrowDown" ? 1 : -1),
                  ),
                ),
        );
    } else if (
      event.key === "Enter" ||
      (event.key === " " && event.target === trigger.current)
    ) {
      event.preventDefault();
      if (open) choose(active);
      else {
        setOpen(true);
        setActive(
          Math.max(
            0,
            visible.findIndex((o) => o.value === value),
          ),
        );
      }
    }
  };
  return (
    <div className={`custom-select ${className || ""}`} ref={root}>
      <button
        ref={trigger}
        type="button"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={`${id}-list`}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        disabled={disabled}
        onKeyDown={keys}
        onClick={() => {
          setOpen(!open);
          setSearch("");
          setActive(
            Math.max(
              0,
              options.findIndex((o) => o.value === value),
            ),
          );
        }}
        className={`select-trigger ${open ? "is-open" : ""}`}
        id={props.id}
      >
        <span>{selected?.label || "Choose"}</span>
        <Icon name="chevron" size={16} />
      </button>
      {open
        ? createPortal(
            <div
              className="select-popover"
              ref={popup}
              style={position}
              onKeyDown={keys}
            >
              {searchable ? (
                <div className="select-search">
                  <Icon name="search" size={16} />
                  <input
                    autoFocus
                    aria-label={`Search ${label}`}
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setActive(0);
                    }}
                    placeholder="Search…"
                  />
                </div>
              ) : null}
              <div
                role="listbox"
                aria-label={label}
                id={`${id}-list`}
                className="select-options"
              >
                {visible.map((option, index) => (
                  <button
                    type="button"
                    role="option"
                    data-value={option.value}
                    id={`${id}-${index}`}
                    key={option.value}
                    aria-selected={option.value === value}
                    disabled={option.disabled}
                    tabIndex={-1}
                    className={active === index ? "active" : ""}
                    onPointerMove={() => setActive(index)}
                    onClick={() => choose(index)}
                  >
                    <span>{option.label}</span>
                    {option.value === value ? (
                      <Icon name="check" size={16} />
                    ) : null}
                  </button>
                ))}
                {!visible.length ? (
                  <p className="select-empty">No results</p>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export type Notice = {
  id: string;
  message: string;
  time: number;
  read: boolean;
  tone: "info" | "success" | "error";
};
export function useNotifications() {
  const [items, setItems] = useState<Notice[]>([]),
    [toast, setToast] = useState<Notice | null>(null);
  const notify = useCallback((message: string) => {
    const tone =
      /failed|error|cannot|could not|unavailable|not found|closed|conflict/i.test(
        message,
      )
        ? "error"
        : /saved|accepted|complete|verified|added|transcribed/i.test(message)
          ? "success"
          : "info";
    const item: Notice = {
      id: crypto.randomUUID(),
      message,
      time: Date.now(),
      read: false,
      tone,
    };
    setItems((previous) => [item, ...previous].slice(0, 25));
    setToast(item);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(null), 6500);
    return () => clearTimeout(timeout);
  }, [toast]);
  return {
    items,
    toast,
    notify,
    dismiss: () => setToast(null),
    markRead: () =>
      setItems((previous) => previous.map((n) => ({ ...n, read: true }))),
    clear: () => setItems([]),
  };
}
export function Notifications({
  store,
}: {
  store: ReturnType<typeof useNotifications>;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const unread = store.items.filter((n) => !n.read).length;
  useEffect(() => {
    if (!open) return;
    const dismiss = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  return (
    <>
      <div
        className="notifications"
        ref={root}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      >
        <button
          className="icon-button notification-toggle"
          aria-label="Notifications"
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
            if (!open) store.markRead();
          }}
        >
          <Icon name="bell" />
          {unread ? <span className="notification-dot" /> : null}
        </button>
        {open ? (
          <section
            className="notification-panel"
            aria-label="Notification history"
          >
            <header>
              <strong>Notifications</strong>
              <button className="link" onClick={store.clear}>
                Clear
              </button>
            </header>
            {store.items.length ? (
              store.items.map((n) => (
                <div className={`notification-item ${n.tone}`} key={n.id}>
                  <span className="notification-icon">
                    <Icon
                      name={
                        n.tone === "success"
                          ? "check"
                          : n.tone === "error"
                            ? "shield"
                            : "bell"
                      }
                      size={18}
                    />
                  </span>
                  <div>
                    <p>{n.message}</p>
                    <time>
                      {new Date(n.time).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </div>
                </div>
              ))
            ) : (
              <div className="notification-empty">
                <Icon name="bell" size={30} />
                <p>You’re all caught up</p>
              </div>
            )}
          </section>
        ) : null}
      </div>
      {store.toast
        ? createPortal(
            <div
              className={`toast ${store.toast.tone}`}
              role={store.toast.tone === "error" ? "alert" : "status"}
            >
              <span className="toast-icon">
                <Icon
                  name={
                    store.toast.tone === "success"
                      ? "check"
                      : store.toast.tone === "error"
                        ? "shield"
                        : "bell"
                  }
                />
              </span>
              <p>{store.toast.message}</p>
              <button aria-label="Dismiss notification" onClick={store.dismiss}>
                <Icon name="close" size={18} />
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
