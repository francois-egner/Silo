import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Copy,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { api } from "../../lib/tauri";
import { PROVIDER_PRESETS } from "../../shared/types";
import { useUiStore } from "../../shared/store";
import { Button, EmptyState, Spinner } from "../../shared/ui";
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
          title="Your S3 workspace starts here"
          body="Add an AWS or S3-compatible account to browse buckets, transfer files, and manage policies."
          action={
            <Button
              onClick={() => {
                setEditId(null);
                setWizardOpen(true);
              }}
            >
              <Plus size={16} /> Add account
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
    <div className="flex h-full flex-col anim-fade-in">
      <header className="flex items-center justify-between border-b border-ink-700 px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold">Accounts</h1>
          <p className="text-sm text-mist-400">
            Switch between AWS and compatible stores
          </p>
        </div>
        <Button
          onClick={() => {
            setEditId(null);
            setWizardOpen(true);
          }}
        >
          <Plus size={16} /> Add account
        </Button>
      </header>

      <div className="stagger grid gap-3 p-6 sm:grid-cols-2 xl:grid-cols-3">
        {accounts.data.map((a) => {
          const active = a.id === activeId;
          return (
            <div
              key={a.id}
              className={`group relative rounded-xl border p-4 transition ${
                active
                  ? "border-accent/40 bg-accent/5"
                  : "border-ink-600 bg-ink-800/40 hover:border-ink-500"
              }`}
            >
              <button
                className="w-full text-left"
                onClick={async () => {
                  await api.setActiveAccount(a.id);
                  setActive(a.id);
                  onOpenBuckets(a.id);
                }}
              >
                <div className="mb-1 text-xs uppercase tracking-wide text-mist-400">
                  {PROVIDER_PRESETS[a.provider as keyof typeof PROVIDER_PRESETS].label}
                </div>
                <div className="mb-3 text-lg font-semibold text-mist-100">
                  {a.name}
                </div>
                <div className="font-mono text-xs text-mist-400">
                  {a.region}
                  {a.endpointUrl ? ` · ${a.endpointUrl}` : ""}
                </div>
                <div className="mt-2 truncate font-mono text-xs text-mist-400/80">
                  {a.accessKeyId}
                </div>
              </button>

              <div className="absolute right-3 top-3">
                <button
                  className="rounded-md p-1.5 text-mist-400 hover:bg-ink-700 hover:text-mist-100"
                  onClick={() => setMenuId(menuId === a.id ? null : a.id)}
                >
                  <MoreHorizontal size={16} />
                </button>
                {menuId === a.id && (
                  <div className="absolute right-0 z-10 mt-1 w-40 overflow-hidden rounded-lg border border-ink-600 bg-ink-800 shadow-xl">
                    <button
                      className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-ink-700"
                      onClick={() => {
                        setEditId(a.id);
                        setWizardOpen(true);
                        setMenuId(null);
                      }}
                    >
                      <Pencil size={14} /> Edit
                    </button>
                    <button
                      className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-ink-700"
                      onClick={() => {
                        dup.mutate(a.id);
                        setMenuId(null);
                      }}
                    >
                      <Copy size={14} /> Duplicate
                    </button>
                    <button
                      className="flex w-full items-center gap-2 px-3 py-2 text-sm text-danger hover:bg-ink-700"
                      onClick={() => {
                        if (confirm(`Delete account “${a.name}”?`)) {
                          remove.mutate(a.id);
                        }
                        setMenuId(null);
                      }}
                    >
                      <Trash2 size={14} /> Delete
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
