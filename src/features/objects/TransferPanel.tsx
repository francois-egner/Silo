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
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border border-ink-600 bg-ink-800 px-4 py-2 text-sm shadow-xl hover:border-accent/40"
        onClick={() => setOpen(true)}
      >
        <ArrowDownUp size={16} className="text-accent" />
        Transfers ({transfers.length})
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-40 w-[360px] overflow-hidden rounded-2xl border border-ink-600 bg-ink-800 shadow-2xl anim-fade-up">
      <div className="flex items-center justify-between border-b border-ink-600 px-4 py-3">
        <div className="font-medium">Transfers</div>
        <div className="flex gap-1">
          <Button variant="ghost" className="px-2 text-xs" onClick={clearDone}>
            Clear done
          </Button>
          <button
            className="rounded-md p-1 text-mist-400 hover:bg-ink-700"
            onClick={() => setOpen(false)}
          >
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="max-h-72 overflow-auto">
        {!transfers.length && (
          <div className="px-4 py-8 text-center text-sm text-mist-400">
            No transfers yet
          </div>
        )}
        {transfers.map((t) => {
          const pct =
            t.total > 0 ? Math.min(100, Math.round((t.bytes / t.total) * 100)) : 0;
          return (
            <div key={t.id} className="border-b border-ink-700/80 px-4 py-3">
              <div className="mb-1 flex justify-between gap-2 text-xs">
                <span className="truncate font-mono text-mist-200">{t.key}</span>
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
              <div className="mb-1 h-1.5 overflow-hidden rounded-full bg-ink-700">
                <div
                  className="h-full rounded-full bg-accent transition-all duration-300"
                  style={{ width: `${t.status === "done" ? 100 : pct}%` }}
                />
              </div>
              <div className="text-xs text-mist-400">
                {t.kind} · {formatBytes(t.bytes)}
                {t.total ? ` / ${formatBytes(t.total)}` : ""}
              </div>
              {t.error && (
                <div className="mt-1 text-xs text-danger">{t.error}</div>
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
        : "border-ink-600 bg-ink-800 text-mist-100";

  return (
    <div
      className={`fixed left-1/2 top-5 z-50 -translate-x-1/2 rounded-xl border px-4 py-2 text-sm shadow-xl anim-fade-up ${tone}`}
    >
      {toast.message}
    </div>
  );
}
