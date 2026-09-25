import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Copy,
  HardDrive,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { api } from "../../lib/tauri";
import { PROVIDER_PRESETS } from "../../shared/types";
import { useUiStore } from "../../shared/store";
import {
  Button,
  EmptyState,
  Spinner,
  Toolbar,
  ToolbarButton,
} from "../../shared/ui";
import { AccountWizard } from "./AccountWizard";

export function AccountsHome({
  onOpenBuckets,
}: {
  onOpenBuckets: (accountId: string) => void;
}) {
  const qc = useQueryClient();
  const showToast = useUiStore((s) => s.showToast);
  const activeId = useUiStore((s) => s.activeAccountId);
  const setActive = useUiStore((s) => s.setActiveAccountId);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);

  const accounts = useQuery({ queryKey: ["accounts"], queryFn: api.listAccounts });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteAccount(id),
    onSuccess: async (_, id) => {
      await qc.invalidateQueries({ queryKey: ["accounts"] });
      if (activeId === id) {
        await api.setActiveAccount(null);
        setActive(null);
      }
      showToast("Account removed", "ok");
    },
    onError: (e: Error) => showToast(String(e), "err"),
  });

  const dup = useMutation({
    mutationFn: (id: string) => api.duplicateAccount(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["accounts"] });
      showToast("Account duplicated", "ok");
    },
    onError: (e: Error) => showToast(String(e), "err"),
  });

  if (accounts.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (!accounts.data?.length) {
    return (
      <>
        <EmptyState
          icon={<HardDrive size={28} />}
          title="No accounts yet"
          body="Add an AWS or S3-compatible account to browse buckets and transfer files."
          action={
            <Button
              onClick={() => {
                setEditId(null);
                setWizardOpen(true);
              }}
            >
              <Plus size={14} /> Add account
            </Button>
          }
        />
        <AccountWizard
          open={wizardOpen}
          editId={editId}
          onClose={() => setWizardOpen(false)}
        />
      </>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <Toolbar className="justify-between">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold">Accounts</div>
          <div className="text-[11px] text-muted">
            {accounts.data.length} account
            {accounts.data.length === 1 ? "" : "s"}
          </div>
        </div>
        <ToolbarButton
          className="bg-accent text-on-accent hover:bg-accent-hover"
          onClick={() => {
            setEditId(null);
            setWizardOpen(true);
          }}
        >
          <Plus size={14} /> Add account
        </ToolbarButton>
      </Toolbar>

      <div className="flex-1 overflow-auto bg-panel">
        <div className="sticky top-0 z-[1] grid grid-cols-[1fr_140px_120px_minmax(0,1.2fr)_36px] gap-2 border-b border-line bg-toolbar px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
          <div>Name</div>
          <div>Provider</div>
          <div>Region</div>
          <div>Access key</div>
          <div />
        </div>
        {accounts.data.map((a) => {
          const active = a.id === activeId;
          return (
            <div
              key={a.id}
              className={`group relative grid grid-cols-[1fr_140px_120px_minmax(0,1.2fr)_36px] items-center gap-2 border-b border-line px-3 py-1.5 ${
                active ? "bg-selected-muted" : "hover:bg-hover"
              }`}
            >
              <button
                className="min-w-0 truncate text-left text-[13px] font-medium text-fg"
                onClick={async () => {
                  await api.setActiveAccount(a.id);
                  setActive(a.id);
                  onOpenBuckets(a.id);
                }}
              >
                {a.name}
              </button>
              <button
                className="truncate text-left text-[12px] text-muted"
                onClick={async () => {
                  await api.setActiveAccount(a.id);
                  setActive(a.id);
                  onOpenBuckets(a.id);
                }}
              >
                {
                  PROVIDER_PRESETS[a.provider as keyof typeof PROVIDER_PRESETS]
                    .label
                }
              </button>
              <button
                className="truncate text-left font-mono text-[12px] text-muted"
                onClick={async () => {
                  await api.setActiveAccount(a.id);
                  setActive(a.id);
                  onOpenBuckets(a.id);
                }}
              >
                {a.region}
              </button>
              <button
                className="truncate text-left font-mono text-[12px] text-muted"
                onClick={async () => {
                  await api.setActiveAccount(a.id);
                  setActive(a.id);
                  onOpenBuckets(a.id);
                }}
                title={a.endpointUrl ?? a.accessKeyId}
              >
                {a.accessKeyId}
              </button>

              <div className="relative flex justify-end">
                <button
                  className="rounded p-1 text-muted hover:bg-hover hover:text-fg"
                  onClick={() => setMenuId(menuId === a.id ? null : a.id)}
                >
                  <MoreHorizontal size={14} />
                </button>
                {menuId === a.id && (
                  <div className="absolute right-0 top-7 z-10 w-36 overflow-hidden rounded-md border border-line bg-panel shadow-[var(--shadow)]">
                    <button
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-hover"
                      onClick={() => {
                        setEditId(a.id);
                        setWizardOpen(true);
                        setMenuId(null);
                      }}
                    >
                      <Pencil size={12} /> Edit
                    </button>
                    <button
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-hover"
                      onClick={() => {
                        dup.mutate(a.id);
                        setMenuId(null);
                      }}
                    >
                      <Copy size={12} /> Duplicate
                    </button>
                    <button
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] text-danger hover:bg-hover"
                      onClick={() => {
                        if (confirm(`Delete account “${a.name}”?`)) {
                          remove.mutate(a.id);
                        }
                        setMenuId(null);
                      }}
                    >
                      <Trash2 size={12} /> Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <AccountWizard
        open={wizardOpen}
        editId={editId}
        onClose={() => setWizardOpen(false)}
      />
    </div>
  );
}
