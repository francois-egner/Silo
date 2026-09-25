import { useEffect } from "react";
import { ArrowDownUp, X } from "lucide-react";
import { useUiStore } from "../../shared/store";
import { formatBytes } from "../../lib/tauri";
import { Button } from "../../shared/ui";

export function TransferPanel() {
  const open = useUiStore((s) => s.transferOpen);
  const setOpen = useUiStore((s) => s.setTransferOpen);
  const transfers = useUiStore((s) => s.transfers);
  const clearDone = useUiStore((s) => s.clearDoneTransfers);

  if (!open) {
    if (!transfers.length) return null;
    return (
      <button
        className="fixed bottom-4 right-4 z-40 flex h-8 items-center gap-2 rounded-md border border-line bg-panel px-3 text-[12px] font-medium shadow-[var(--shadow)] hover:bg-hover"
        onClick={() => setOpen(true)}
      >
        <ArrowDownUp size={14} className="text-accent" />
        Transfers ({transfers.length})
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 w-[340px] overflow-hidden rounded-lg border border-line bg-panel shadow-[var(--shadow)] anim-fade-up">
      <div className="flex h-9 items-center justify-between border-b border-line px-3">
        <div className="text-[13px] font-semibold">Transfers</div>
        <div className="flex gap-1">
          <Button variant="ghost" className="px-2 text-[11px]" onClick={clearDone}>
            Clear done
          </Button>
          <button
            className="rounded p-1 text-muted hover:bg-hover hover:text-fg"
            onClick={() => setOpen(false)}
          >
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="max-h-72 overflow-auto">
        {!transfers.length && (
          <div className="px-3 py-8 text-center text-[13px] text-muted">
            No transfers yet
          </div>
        )}
        {transfers.map((t) => {
          const pct =
            t.total > 0 ? Math.min(100, Math.round((t.bytes / t.total) * 100)) : 0;
          return (
            <div key={t.id} className="border-b border-line px-3 py-2.5">
              <div className="mb-1 flex justify-between gap-2 text-[11px]">
                <span className="truncate font-mono text-fg">{t.key}</span>
                <span
                  className={
                    t.status === "error"
                      ? "text-danger"
                      : t.status === "done"
                        ? "text-ok"
                        : "text-accent"
                  }
                >
                  {t.status}
                </span>
              </div>
              <div className="mb-1 h-1.5 overflow-hidden rounded bg-hover">
                <div
                  className="h-full rounded bg-accent transition-all duration-300"
                  style={{ width: `${t.status === "done" ? 100 : pct}%` }}
                />
              </div>
              <div className="text-[11px] text-muted">
                {t.kind} · {formatBytes(t.bytes)}
                {t.total ? ` / ${formatBytes(t.total)}` : ""}
              </div>
              {t.error && (
                <div className="mt-1 text-[11px] text-danger">{t.error}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ToastHost() {
  const toast = useUiStore((s) => s.toast);
  const clear = useUiStore((s) => s.clearToast);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(clear, 3200);
    return () => clearTimeout(t);
  }, [toast, clear]);

  if (!toast) return null;
  const tone =
    toast.tone === "ok"
      ? "border-ok/40 bg-ok/15 text-ok"
      : toast.tone === "err"
        ? "border-danger/40 bg-danger/15 text-danger"
        : "border-line bg-panel text-fg";

  return (
    <div
      className={`fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-md border px-3 py-1.5 text-[13px] shadow-[var(--shadow)] anim-fade-up ${tone}`}
    >
      {toast.message}
    </div>
  );
}
