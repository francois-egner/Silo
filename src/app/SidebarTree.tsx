import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  HardDrive,
  Loader2,
  Package,
} from "lucide-react";
import { api } from "../lib/tauri";
import type { Account, BucketSettingsTab } from "../shared/types";
import { filterVisibleBuckets } from "../shared/buckets";
import { useUiStore } from "../shared/store";
import {
  ContextMenu,
  type ContextMenuItem,
} from "../features/objects/ContextMenu";

export type NavTarget =
  | { kind: "buckets"; accountId: string }
  | { kind: "objects"; accountId: string; bucket: string; prefix: string }
  | {
      kind: "settings";
      accountId: string;
      bucket: string;
      tab?: BucketSettingsTab;
    };

export type BucketActions = {
  onEmptyBucket: (accountId: string, bucket: string) => void;
  onDeleteBucket: (accountId: string, bucket: string) => void;
};

function accountKey(id: string) {
  return `a:${id}`;
}
function bucketKey(accountId: string, bucket: string) {
  return `b:${accountId}:${bucket}`;
}
function folderKey(accountId: string, bucket: string, prefix: string) {
  return `f:${accountId}:${bucket}:${prefix}`;
}

function FolderBranch({
  accountId,
  bucket,
  prefix,
  depth,
  expanded,
  toggle,
  active,
  onNavigate,
}: {
  accountId: string;
  bucket: string;
  prefix: string;
  depth: number;
  expanded: Set<string>;
  toggle: (id: string) => void;
  active: { accountId?: string; bucket?: string; prefix?: string };
  onNavigate: (t: NavTarget) => void;
}) {
  const id = folderKey(accountId, bucket, prefix);
  const open = expanded.has(id);
  const folders = useQuery({
    queryKey: ["objects", accountId, bucket, prefix],
    queryFn: () => api.listObjects(accountId, bucket, prefix),
    enabled: open,
    staleTime: 30_000,
  });
  const children = (folders.data?.entries ?? []).filter((e) => e.isFolder);
  const name = prefix.replace(/\/$/, "").split("/").pop() ?? prefix;
  const isActive =
    active.accountId === accountId &&
    active.bucket === bucket &&
    (active.prefix ?? "") === prefix;

  return (
    <div>
      <div
        className={`group flex w-full items-center gap-0.5 rounded-md text-left text-[13px] ${
          isActive
            ? "bg-selected text-on-accent"
            : "text-fg hover:bg-hover"
        }`}
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        <button
          type="button"
          className="shrink-0 rounded p-0.5 text-muted hover:text-fg"
          onClick={(e) => {
            e.stopPropagation();
            toggle(id);
          }}
        >
          {folders.isFetching && open ? (
            <Loader2 size={12} className="animate-spin" />
          ) : open ? (
            <ChevronDown size={12} />
          ) : (
            <ChevronRight size={12} />
          )}
        </button>
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pr-2"
          onClick={() =>
            onNavigate({ kind: "objects", accountId, bucket, prefix })
          }
          onDoubleClick={() => toggle(id)}
        >
          <Folder size={13} className="shrink-0 opacity-80" />
          <span className="truncate">{name}</span>
        </button>
      </div>
      {open &&
        children.map((f) => (
          <FolderBranch
            key={f.key}
            accountId={accountId}
            bucket={bucket}
            prefix={f.key}
            depth={depth + 1}
            expanded={expanded}
            toggle={toggle}
            active={active}
            onNavigate={onNavigate}
          />
        ))}
    </div>
  );
}

function BucketBranch({
  accountId,
  bucket,
  depth,
  expanded,
  toggle,
  active,
  onNavigate,
  bucketActions,
}: {
  accountId: string;
  bucket: string;
  depth: number;
  expanded: Set<string>;
  toggle: (id: string) => void;
  active: { accountId?: string; bucket?: string; prefix?: string };
  onNavigate: (t: NavTarget) => void;
  bucketActions: BucketActions;
}) {
  const qc = useQueryClient();
  const showToast = useUiStore((s) => s.showToast);
  const id = bucketKey(accountId, bucket);
  const open = expanded.has(id);
  const root = useQuery({
    queryKey: ["objects", accountId, bucket, ""],
    queryFn: () => api.listObjects(accountId, bucket, ""),
    enabled: open,
    staleTime: 30_000,
  });
  const folders = (root.data?.entries ?? []).filter((e) => e.isFolder);
  const isActive =
    active.accountId === accountId &&
    active.bucket === bucket &&
    (active.prefix ?? "") === "";
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const menuItems: ContextMenuItem[] = [
    {
      kind: "action",
      id: "open",
      label: "Open bucket",
      onSelect: () =>
        onNavigate({ kind: "objects", accountId, bucket, prefix: "" }),
    },
    {
      kind: "action",
      id: "configure",
      label: "Configure…",
      onSelect: () =>
        onNavigate({
          kind: "settings",
          accountId,
          bucket,
          tab: "overview",
        }),
    },
    {
      kind: "action",
      id: "copy",
      label: "Copy bucket name",
      onSelect: async () => {
        try {
          await navigator.clipboard.writeText(bucket);
          showToast("Bucket name copied", "ok");
        } catch (e) {
          showToast(String(e), "err");
        }
      },
    },
    {
      kind: "action",
      id: "refresh",
      label: "Refresh",
      onSelect: () => {
        void qc.invalidateQueries({ queryKey: ["buckets", accountId] });
        void qc.invalidateQueries({
          queryKey: ["objects", accountId, bucket],
        });
        showToast("Refreshed", "info");
      },
    },
    { kind: "sep" },
    {
      kind: "action",
      id: "empty",
      label: "Empty bucket…",
      danger: true,
      onSelect: () => bucketActions.onEmptyBucket(accountId, bucket),
    },
    {
      kind: "action",
      id: "delete",
      label: "Delete bucket…",
      danger: true,
      onSelect: () => bucketActions.onDeleteBucket(accountId, bucket),
    },
  ];

  return (
    <div>
      <div
        className={`group flex w-full select-none items-center gap-0.5 rounded-md text-left text-[13px] ${
          isActive
            ? "bg-selected text-on-accent"
            : "text-fg hover:bg-hover"
        }`}
        style={{ paddingLeft: 8 + depth * 12 }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          window.getSelection()?.removeAllRanges();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <button
          type="button"
          className="shrink-0 rounded p-0.5 text-muted hover:text-fg"
          onClick={(e) => {
            e.stopPropagation();
            toggle(id);
          }}
        >
          {root.isFetching && open ? (
            <Loader2 size={12} className="animate-spin" />
          ) : open ? (
            <ChevronDown size={12} />
          ) : (
            <ChevronRight size={12} />
          )}
        </button>
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pr-2"
          onClick={() =>
            onNavigate({
              kind: "objects",
              accountId,
              bucket,
              prefix: "",
            })
          }
          onDoubleClick={() => toggle(id)}
        >
          <Package size={13} className="shrink-0" />
          <span className="truncate">{bucket}</span>
        </button>
      </div>
      {open &&
        folders.map((f) => (
          <FolderBranch
            key={f.key}
            accountId={accountId}
            bucket={bucket}
            prefix={f.key}
            depth={depth + 1}
            expanded={expanded}
            toggle={toggle}
            active={active}
            onNavigate={onNavigate}
          />
        ))}
      <ContextMenu
        open={!!menu}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        onClose={() => setMenu(null)}
        header={
          <div className="flex items-center gap-2 truncate">
            <Package size={14} className="shrink-0" />
            <span className="truncate">{bucket}</span>
          </div>
        }
        items={menuItems}
      />
    </div>
  );
}

function AccountBranch({
  account,
  expanded,
  toggle,
  active,
  onNavigate,
  bucketActions,
}: {
  account: Account;
  expanded: Set<string>;
  toggle: (id: string) => void;
  active: { accountId?: string; bucket?: string; prefix?: string };
  onNavigate: (t: NavTarget) => void;
  bucketActions: BucketActions;
}) {
  const id = accountKey(account.id);
  const open = expanded.has(id);
  const buckets = useQuery({
    queryKey: ["buckets", account.id],
    queryFn: () => api.listBuckets(account.id),
    enabled: open,
    staleTime: 30_000,
  });
  const isActiveAccount = active.accountId === account.id && !active.bucket;

  return (
    <div className="mb-0.5">
      <div
        className={`group flex w-full items-center gap-0.5 rounded-md text-left text-[13px] ${
          isActiveAccount
            ? "bg-selected text-on-accent"
            : active.accountId === account.id
              ? "text-fg"
              : "text-fg hover:bg-hover"
        }`}
      >
        <button
          type="button"
          className="ml-1 shrink-0 rounded p-0.5 text-muted hover:text-fg"
          onClick={(e) => {
            e.stopPropagation();
            toggle(id);
          }}
        >
          {buckets.isFetching && open ? (
            <Loader2 size={14} className="animate-spin" />
          ) : open ? (
            <ChevronDown size={14} />
          ) : (
            <ChevronRight size={14} />
          )}
        </button>
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2"
          onClick={() => onNavigate({ kind: "buckets", accountId: account.id })}
          onDoubleClick={() => toggle(id)}
        >
          <HardDrive size={14} className="shrink-0" />
          <span className="truncate font-medium">{account.name}</span>
        </button>
      </div>
      {open &&
        filterVisibleBuckets(account, buckets.data ?? []).map((b) => (
          <BucketBranch
            key={b.name}
            accountId={account.id}
            bucket={b.name}
            depth={1}
            expanded={expanded}
            toggle={toggle}
            active={active}
            onNavigate={onNavigate}
            bucketActions={bucketActions}
          />
        ))}
    </div>
  );
}

export function SidebarTree({
  accounts,
  active,
  onNavigate,
  bucketActions,
}: {
  accounts: Account[];
  active: { accountId?: string; bucket?: string; prefix?: string };
  onNavigate: (t: NavTarget) => void;
  bucketActions: BucketActions;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  useEffect(() => {
    if (!active.accountId) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add(accountKey(active.accountId!));
      if (active.bucket) {
        next.add(bucketKey(active.accountId!, active.bucket));
        const parts = (active.prefix ?? "").split("/").filter(Boolean);
        let acc = "";
        for (const p of parts) {
          acc += `${p}/`;
          next.add(folderKey(active.accountId!, active.bucket!, acc));
        }
      }
      return next;
    });
  }, [active.accountId, active.bucket, active.prefix]);

  return (
    <div className="space-y-0.5">
      {accounts.map((a) => (
        <AccountBranch
          key={a.id}
          account={a}
          expanded={expanded}
          toggle={toggle}
          active={active}
          onNavigate={onNavigate}
          bucketActions={bucketActions}
        />
      ))}
      {!accounts.length && (
        <p className="px-2 py-2 text-[12px] text-muted">No accounts yet</p>
      )}
    </div>
  );
}
