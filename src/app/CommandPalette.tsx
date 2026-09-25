import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/tauri";
import { filterVisibleBuckets } from "../shared/buckets";
import { useUiStore } from "../shared/store";

export function CommandPalette({
  onGoAccounts,
  onGoBuckets,
  onOpenBucket,
}: {
  onGoAccounts: () => void;
  onGoBuckets: (accountId: string) => void;
  onOpenBucket: (accountId: string, bucket: string) => void;
}) {
  const open = useUiStore((s) => s.commandOpen);
  const setOpen = useUiStore((s) => s.setCommandOpen);
  const activeId = useUiStore((s) => s.activeAccountId);
  const [q, setQ] = useState("");

  const accounts = useQuery({
    queryKey: ["accounts"],
    queryFn: api.listAccounts,
    enabled: open,
  });
  const buckets = useQuery({
    queryKey: ["buckets", activeId],
    queryFn: () => api.listBuckets(activeId!),
    enabled: open && !!activeId,
  });

  const activeAccount = accounts.data?.find((a) => a.id === activeId);
  const visibleBuckets = useMemo(
    () => filterVisibleBuckets(activeAccount, buckets.data ?? []),
    [activeAccount, buckets.data],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!open);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  const actions = useMemo(() => {
    const items: { id: string; label: string; run: () => void }[] = [
      {
        id: "accounts",
        label: "Go to accounts",
        run: () => {
          onGoAccounts();
          setOpen(false);
        },
      },
    ];
    if (activeId) {
      items.push({
        id: "buckets",
        label: "Go to buckets",
        run: () => {
          onGoBuckets(activeId);
          setOpen(false);
        },
      });
    }
    for (const a of accounts.data ?? []) {
      items.push({
        id: `acc-${a.id}`,
        label: `Account · ${a.name}`,
        run: async () => {
          await api.setActiveAccount(a.id);
          useUiStore.getState().setActiveAccountId(a.id);
          onGoBuckets(a.id);
          setOpen(false);
        },
      });
    }
    for (const b of visibleBuckets) {
      items.push({
        id: `bkt-${b.name}`,
        label: `Bucket · ${b.name}`,
        run: () => {
          if (activeId) onOpenBucket(activeId, b.name);
          setOpen(false);
        },
      });
    }
    const query = q.trim().toLowerCase();
    if (!query) return items.slice(0, 12);
    return items.filter((i) => i.label.toLowerCase().includes(query)).slice(0, 12);
  }, [
    accounts.data,
    visibleBuckets,
    activeId,
    q,
    onGoAccounts,
    onGoBuckets,
    onOpenBucket,
    setOpen,
  ]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-overlay p-20 anim-fade-in">
      <div className="w-full max-w-md overflow-hidden rounded-lg border border-line bg-panel shadow-[var(--shadow)] anim-fade-up">
        <input
          autoFocus
          className="w-full border-b border-line bg-transparent px-3 py-2.5 text-[13px] outline-none placeholder:text-muted"
          placeholder="Search accounts, buckets, actions…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <ul className="max-h-80 overflow-auto py-1">
          {actions.map((a) => (
            <li key={a.id}>
              <button
                className="w-full px-3 py-1.5 text-left text-[13px] hover:bg-selected hover:text-on-accent"
                onClick={a.run}
              >
                {a.label}
              </button>
            </li>
          ))}
          {!actions.length && (
            <li className="px-3 py-6 text-center text-[13px] text-muted">
              No matches
            </li>
          )}
        </ul>
        <div className="border-t border-line px-3 py-1.5 text-[11px] text-muted">
          ⌘K / Ctrl+K to toggle
        </div>
      </div>
    </div>
  );
}
