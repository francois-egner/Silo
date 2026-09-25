import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

export function Button({
  variant = "primary",
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger" | "subtle";
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed";
  const styles = {
    primary:
      "bg-accent text-ink-950 hover:bg-accent-dim shadow-[0_0_0_1px_rgba(45,212,191,0.3)]",
    ghost:
      "bg-transparent text-mist-200 hover:bg-ink-700 hover:text-mist-100 border border-transparent",
    subtle:
      "bg-ink-700/80 text-mist-100 hover:bg-ink-600 border border-ink-600",
    danger: "bg-danger/15 text-danger hover:bg-danger/25 border border-danger/30",
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
      className={`w-full rounded-lg border border-ink-600 bg-ink-900/80 px-3 py-2 text-sm text-mist-100 placeholder:text-mist-400/70 outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20 ${className}`}
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
      className={`w-full rounded-lg border border-ink-600 bg-ink-900/80 px-3 py-2 text-sm font-mono text-mist-100 placeholder:text-mist-400/70 outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20 ${className}`}
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
      className={`w-full rounded-lg border border-ink-600 bg-ink-900/80 px-3 py-2 text-sm text-mist-100 outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20 ${className}`}
      {...props}
    >
      {children}
    </select>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return (
    <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-mist-400">
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
    <div className="mb-4">
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
        className="absolute inset-0 bg-ink-950/70 backdrop-blur-sm"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        className={`relative z-10 max-h-[90vh] overflow-auto rounded-2xl border border-ink-600 bg-ink-800 shadow-2xl anim-fade-up ${
          wide ? "w-full max-w-3xl" : "w-full max-w-lg"
        }`}
      >
        <div className="flex items-center justify-between border-b border-ink-600 px-5 py-4">
          <h2 className="text-lg font-semibold text-mist-100">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-mist-400 hover:bg-ink-700 hover:text-mist-100"
          >
            Esc
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-[60vh] flex-col items-center justify-center px-8 text-center anim-fade-up">
      <div className="mb-6 text-5xl font-semibold tracking-tight text-mist-100">
        <span className="text-accent">S</span>ilo
      </div>
      <h1 className="mb-2 text-2xl font-semibold text-mist-100">{title}</h1>
      <p className="mb-8 max-w-md text-mist-400">{body}</p>
      {action}
    </div>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <div
      className={`h-4 w-4 animate-spin rounded-full border-2 border-mist-400/30 border-t-accent ${className}`}
    />
  );
}
