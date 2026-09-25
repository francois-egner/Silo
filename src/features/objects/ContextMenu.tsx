import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export type ContextMenuItem =
  | {
      kind: "action";
      id: string;
      label: string;
      danger?: boolean;
      disabled?: boolean;
      onSelect: () => void;
    }
  | { kind: "sep" };

export function ContextMenu({
  open,
  x,
  y,
  onClose,
  header,
  info,
  items,
}: {
  open: boolean;
  x: number;
  y: number;
  onClose: () => void;
  header?: ReactNode;
  info?: { label: string; value: string }[];
  items: ContextMenuItem[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    if (!open || !ref.current) {
      setPos({ left: x, top: y });
      return;
    }
    const el = ref.current;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - pad) {
      left = Math.max(pad, window.innerWidth - rect.width - pad);
    }
    if (top + rect.height > window.innerHeight - pad) {
      top = Math.max(pad, window.innerHeight - rect.height - pad);
    }
    setPos({ left, top });
  }, [open, x, y, info, items]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[200] w-56 overflow-hidden rounded-md border border-line bg-panel shadow-[var(--shadow)] anim-fade-up"
      style={{ left: pos.left, top: pos.top }}
      role="menu"
    >
      {header && (
        <div className="border-b border-line px-2.5 py-2 text-[12px] font-medium text-fg">
          {header}
        </div>
      )}
      {info && info.length > 0 && (
        <div className="space-y-1 border-b border-line px-2.5 py-2">
          {info.map((row) => (
            <div key={row.label} className="flex gap-2 text-[11px] leading-snug">
              <span className="w-16 shrink-0 text-muted">{row.label}</span>
              <span className="min-w-0 break-all font-mono text-fg">
                {row.value}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="py-0.5">
        {items.map((item, i) => {
          if (item.kind === "sep") {
            return (
              <div
                key={`sep-${i}`}
                className="my-0.5 border-t border-line"
              />
            );
          }
          return (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={`flex w-full px-2.5 py-1.5 text-left text-[12px] disabled:opacity-40 ${
                item.danger
                  ? "text-danger hover:bg-danger/10"
                  : "text-fg hover:bg-hover"
              }`}
              onClick={() => {
                item.onSelect();
                onClose();
              }}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
