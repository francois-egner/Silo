import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from "react";
import { X } from "lucide-react";

export function Button({
  variant = "primary",
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger" | "subtle";
}) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition disabled:opacity-40 disabled:cursor-not-allowed";
  const styles = {
    primary: "bg-accent text-on-accent hover:bg-accent-hover",
    ghost: "bg-transparent text-fg hover:bg-hover border border-transparent",
    subtle: "bg-panel text-fg hover:bg-hover border border-line",
    danger:
      "bg-danger/10 text-danger hover:bg-danger/20 border border-danger/25",
  }[variant];
  return (
    <button className={`${base} ${styles} ${className}`} {...props}>
      {children}
    </button>
  );
}

export function Input({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-md border border-line bg-input px-2.5 py-1.5 text-[13px] text-fg placeholder:text-muted outline-none focus:border-accent focus:ring-1 focus:ring-accent/40 ${className}`}
      {...props}
    />
  );
}

export function TextArea({
  className = "",
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`w-full rounded-md border border-line bg-input px-2.5 py-1.5 text-[13px] font-mono text-fg placeholder:text-muted outline-none focus:border-accent focus:ring-1 focus:ring-accent/40 ${className}`}
      {...props}
    />
  );
}

export function Select({
  className = "",
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`w-full rounded-md border border-line bg-input px-2.5 py-1.5 text-[13px] text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent/40 ${className}`}
      {...props}
    >
      {children}
    </select>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return (
    <label className="mb-1 block text-[12px] font-medium text-muted">
      {children}
    </label>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-3">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
  wide,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 anim-fade-in">
      <button
        className="absolute inset-0 bg-overlay"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        className={`relative z-10 max-h-[90vh] overflow-auto rounded-lg border border-line bg-panel shadow-[var(--shadow)] anim-fade-up ${
          wide ? "w-full max-w-3xl" : "w-full max-w-lg"
        }`}
      >
        <div className="flex h-10 items-center justify-between border-b border-line px-3">
          <h2 className="text-[13px] font-semibold text-fg">{title}</h2>
          <button
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-hover hover:text-fg"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
  icon,
}: {
  title: string;
  body: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-[40vh] flex-col items-center justify-center px-8 text-center">
      {icon ? <div className="mb-3 text-muted">{icon}</div> : null}
      <h1 className="mb-1 text-[15px] font-semibold text-fg">{title}</h1>
      <p className="mb-5 max-w-sm text-[13px] text-muted">{body}</p>
      {action}
    </div>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <div
      className={`h-4 w-4 animate-spin rounded-full border-2 border-muted/30 border-t-accent ${className}`}
    />
  );
}

export function Toolbar({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex h-10 shrink-0 items-center gap-2 border-b border-line bg-toolbar px-3 ${className}`}
    >
      {children}
    </div>
  );
}

export function ToolbarButton({
  className = "",
  children,
  active,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      className={`inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2 text-[12px] font-medium transition disabled:opacity-40 ${
        active
          ? "bg-selected text-on-accent"
          : "text-fg hover:bg-hover"
      } ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex h-7 items-center rounded-md border border-line bg-panel p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          title={opt.title}
          className={`inline-flex h-6 items-center gap-1 rounded px-2 text-[12px] font-medium transition ${
            value === opt.value
              ? "bg-selected text-on-accent"
              : "text-muted hover:text-fg"
          }`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function PathBar({
  segments,
  onNavigate,
  leading,
}: {
  segments: { id: string; label: string }[];
  onNavigate: (id: string) => void;
  leading?: ReactNode;
}) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-panel px-2 text-[12px]">
      {leading}
      {segments.map((seg, i) => (
        <div key={seg.id} className="flex shrink-0 items-center gap-1">
          {i > 0 ? <span className="text-muted">/</span> : null}
          <button
            type="button"
            className={`rounded px-1.5 py-0.5 hover:bg-hover ${
              i === segments.length - 1
                ? "font-medium text-fg"
                : "text-muted hover:text-fg"
            }`}
            onClick={() => onNavigate(seg.id)}
          >
            {seg.label}
          </button>
        </div>
      ))}
    </div>
  );
}

export function ListRow({
  children,
  selected,
  onClick,
  className = "",
}: {
  children: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 border-b border-line px-3 py-2 text-left text-[13px] transition ${
        selected
          ? "bg-selected-muted"
          : "hover:bg-hover"
      } ${className}`}
    >
      {children}
    </button>
  );
}

export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-panel text-fg ${className}`}>{children}</div>
  );
}

export function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
      {children}
    </div>
  );
}
