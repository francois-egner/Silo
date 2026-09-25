import { useEffect, useMemo, useState } from "react";
import { File, Folder } from "lucide-react";
import { api, formatBytes, formatDate } from "../../lib/tauri";
import type { ObjectEntry } from "../../shared/types";
import { useUiStore } from "../../shared/store";
import { Spinner } from "../../shared/ui";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import {
  SortHeader,
  sortEntries,
  toggleSort,
  type SortState,
} from "./sort";

export type S3DragPayload = {
  accountId: string;
  bucket: string;
  keys: string[];
  entries: { key: string; name: string; isFolder: boolean }[];
};

export type LocalDragPayload = {
  paths: string[];
};

export type S3ContextActions = {
  onDownload?: (entries: ObjectEntry[]) => void;
  onDelete?: (keys: string[]) => void;
  onPresign?: (key: string) => void;
  onRename?: (key: string) => void;
  onCopyTo?: (entries: ObjectEntry[]) => void;
  onMoveTo?: (entries: ObjectEntry[]) => void;
};

async function folderStats(
  accountId: string,
  bucket: string,
  folderPrefix: string,
): Promise<{ size: number; fileCount: number; folderCount: number }> {
  let size = 0;
  let fileCount = 0;
  let folderCount = 0;
  const queue = [folderPrefix];
  while (queue.length) {
    const prefix = queue.shift()!;
    let token: string | null = null;
    do {
      const page = await api.listObjects(accountId, bucket, prefix, token);
      for (const e of page.entries) {
        if (e.isFolder) {
          folderCount += 1;
          queue.push(e.key);
        } else {
          fileCount += 1;
          size += e.size ?? 0;
        }
      }
      token = page.nextContinuationToken;
    } while (token);
  }
  return { size, fileCount, folderCount };
}

export function S3Pane({
  accountId,
  bucket,
  prefix,
  onPrefixChange,
  entries,
  loading,
  error,
  selected,
  onToggle,
  onSelectAll,
  onClearSelection,
  onOpenEntry,
  dropActive,
  onRowPointerDown,
  compact,
  contextActions,
  onSelectOnly,
}: {
  accountId?: string;
  bucket: string;
  prefix: string;
  onPrefixChange: (prefix: string) => void;
  entries: ObjectEntry[];
  loading: boolean;
  error: Error | null;
  selected: Set<string>;
  onToggle: (key: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onOpenEntry: (entry: ObjectEntry) => void;
  dropActive?: boolean;
  onRowPointerDown?: (e: React.PointerEvent, entry: ObjectEntry) => void;
  compact?: boolean;
  contextActions?: S3ContextActions;
  onSelectOnly?: (key: string) => void;
}) {
  const showToast = useUiStore((s) => s.showToast);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    entry: ObjectEntry;
  } | null>(null);
  const [folderInfo, setFolderInfo] = useState<{
    size: number;
    fileCount: number;
    folderCount: number;
  } | null>(null);
  const [folderLoading, setFolderLoading] = useState(false);
  const [sort, setSort] = useState<SortState>({ key: "name", dir: "asc" });

  useEffect(() => {
    if (!menu?.entry.isFolder || !accountId) {
      setFolderInfo(null);
      return;
    }
    let cancelled = false;
    setFolderLoading(true);
    void folderStats(accountId, bucket, menu.entry.key)
      .then((s) => {
        if (!cancelled) setFolderInfo(s);
      })
      .catch(() => {
        if (!cancelled) setFolderInfo(null);
      })
      .finally(() => {
        if (!cancelled) setFolderLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [menu, accountId, bucket]);

  const crumbs = useMemo(() => {
    const parts = prefix.split("/").filter(Boolean);
    const items: { label: string; prefix: string }[] = [
      { label: bucket, prefix: "" },
    ];
    let acc = "";
    for (const p of parts) {
      acc += `${p}/`;
      items.push({ label: p, prefix: acc });
    }
    return items;
  }, [bucket, prefix]);

  const sortedEntries = useMemo(
    () =>
      sortEntries(entries, sort, {
        isDir: (e) => e.isFolder,
        name: (e) => e.name,
        size: (e) => e.size,
        modified: (e) => e.lastModified,
      }),
    [entries, sort],
  );

  function openMenu(e: React.MouseEvent, entry: ObjectEntry) {
    e.preventDefault();
    e.stopPropagation();
    if (!selected.has(entry.key)) {
      onSelectOnly?.(entry.key);
    }
    setMenu({ x: e.clientX, y: e.clientY, entry });
  }

  const menuEntries = menu
    ? selected.has(menu.entry.key)
      ? sortedEntries.filter((e) => selected.has(e.key))
      : [menu.entry]
    : [];

  const infoRows = (() => {
    if (!menu) return [];
    const e = menu.entry;
    const rows: { label: string; value: string }[] = [
      { label: "Name", value: e.name },
      { label: "Type", value: e.isFolder ? "Folder" : "Object" },
      { label: "Key", value: e.key },
    ];
    if (e.isFolder) {
      if (folderLoading) {
        rows.push({ label: "Size", value: "Calculating…" });
      } else if (folderInfo) {
        rows.push({ label: "Size", value: formatBytes(folderInfo.size) });
        rows.push({
          label: "Contains",
          value: `${folderInfo.fileCount} object${folderInfo.fileCount === 1 ? "" : "s"}, ${folderInfo.folderCount} folder${folderInfo.folderCount === 1 ? "" : "s"}`,
        });
      } else {
        rows.push({ label: "Size", value: "—" });
      }
    } else {
      rows.push({ label: "Size", value: formatBytes(e.size) });
      rows.push({ label: "Modified", value: formatDate(e.lastModified) });
      if (e.storageClass) {
        rows.push({ label: "Storage", value: e.storageClass });
      }
      if (e.etag) {
        rows.push({ label: "ETag", value: e.etag.replace(/"/g, "") });
      }
    }
    if (e.isFolder) {
      rows.push({ label: "Modified", value: formatDate(e.lastModified) });
    }
    return rows;
  })();

  const menuItems: ContextMenuItem[] = menu
    ? [
        ...(menu.entry.isFolder
          ? [
              {
                kind: "action" as const,
                id: "open",
                label: "Open",
                onSelect: () => onOpenEntry(menu.entry),
              },
            ]
          : []),
        {
          kind: "action",
          id: "download",
          label:
            menuEntries.length > 1
              ? `Download ${menuEntries.length} items`
              : menu.entry.isFolder
                ? "Download folder"
                : "Download",
          disabled: !contextActions?.onDownload,
          onSelect: () => contextActions?.onDownload?.(menuEntries),
        },
        {
          kind: "action",
          id: "copy-key",
          label: "Copy key",
          onSelect: async () => {
            try {
              await navigator.clipboard.writeText(menu.entry.key);
              showToast("Key copied", "ok");
            } catch (err) {
              showToast(String(err), "err");
            }
          },
        },
        {
          kind: "action",
          id: "copy-to",
          label:
            menuEntries.length > 1
              ? `Copy ${menuEntries.length} to…`
              : "Copy to…",
          disabled: !contextActions?.onCopyTo,
          onSelect: () => contextActions?.onCopyTo?.(menuEntries),
        },
        {
          kind: "action",
          id: "move-to",
          label:
            menuEntries.length > 1
              ? `Move ${menuEntries.length} to…`
              : "Move to…",
          disabled: !contextActions?.onMoveTo,
          onSelect: () => contextActions?.onMoveTo?.(menuEntries),
        },
        ...(!menu.entry.isFolder
          ? [
              {
                kind: "action" as const,
                id: "presign",
                label: "Copy presigned URL",
                disabled: !contextActions?.onPresign,
                onSelect: () => contextActions?.onPresign?.(menu.entry.key),
              },
              {
                kind: "action" as const,
                id: "rename",
                label: "Rename / move…",
                disabled: !contextActions?.onRename || menuEntries.length !== 1,
                onSelect: () => contextActions?.onRename?.(menu.entry.key),
              },
            ]
          : []),
        { kind: "sep" },
        {
          kind: "action",
          id: "delete",
          label:
            menuEntries.length > 1
              ? `Delete ${menuEntries.length} items`
              : "Delete",
          danger: true,
          disabled: !contextActions?.onDelete,
          onSelect: () =>
            contextActions?.onDelete?.(menuEntries.map((e) => e.key)),
        },
      ]
    : [];

  return (
    <div
      className="relative flex h-full min-w-0 flex-col"
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest("tr")) return;
        e.preventDefault();
      }}
    >
      {dropActive && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-30 rounded-sm bg-accent/5 shadow-[inset_0_0_0_2px_rgba(45,212,191,0.6)]"
        />
      )}
      <nav className="relative z-0 flex h-10 shrink-0 items-center gap-1 overflow-hidden border-b border-ink-700/80 px-3 text-xs">
        <span className="mr-1 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-mist-400">
          S3
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
          {crumbs.map((c, i) => {
            const isLast = i === crumbs.length - 1;
            return (
              <span
                key={c.prefix + c.label}
                className={`flex items-center gap-1 ${isLast ? "min-w-0" : "shrink-0"}`}
              >
                {i > 0 && <span className="shrink-0 text-mist-400">/</span>}
                <button
                  type="button"
                  title={c.label}
                  className={`rounded px-1.5 py-0.5 hover:bg-ink-700 ${
                    isLast
                      ? "min-w-0 truncate font-semibold text-mist-100"
                      : "max-w-[9rem] truncate text-mist-400"
                  }`}
                  onClick={() => onPrefixChange(c.prefix)}
                >
                  {c.label}
                </button>
              </span>
            );
          })}
        </div>
      </nav>

      <div className="flex-1 overflow-auto">
        {loading && (
          <div className="flex justify-center py-16">
            <Spinner className="h-6 w-6" />
          </div>
        )}
        {error && (
          <div className="m-4 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
            {String(error)}
          </div>
        )}
        {!loading && !error && entries.length === 0 && (
          <div className="py-16 text-center text-sm text-mist-400">
            This folder is empty. Drop files here or use Upload.
          </div>
        )}

        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-ink-900/95 text-left text-xs uppercase tracking-wide backdrop-blur">
            <tr>
              <th className="w-10 px-3 py-2.5">
                <input
                  type="checkbox"
                  className="accent-accent"
                  checked={
                    !!entries.length && entries.every((e) => selected.has(e.key))
                  }
                  onChange={(e) => {
                    if (e.target.checked) onSelectAll();
                    else onClearSelection();
                  }}
                />
              </th>
              <SortHeader
                label="Name"
                column="name"
                sort={sort}
                onSort={(key) => setSort((s) => toggleSort(s, key))}
                className="px-2 py-2.5"
              />
              <SortHeader
                label="Size"
                column="size"
                sort={sort}
                onSort={(key) => setSort((s) => toggleSort(s, key))}
                className="w-24 px-3 py-2.5"
              />
              {!compact && (
                <SortHeader
                  label="Modified"
                  column="modified"
                  sort={sort}
                  onSort={(key) => setSort((s) => toggleSort(s, key))}
                  className="w-40 px-3 py-2.5"
                />
              )}
            </tr>
          </thead>
          <tbody className="stagger divide-y divide-ink-700/80">
            {sortedEntries.map((entry) => {
              const isSelected = selected.has(entry.key);
              return (
                <tr
                  key={entry.key}
                  className={`cursor-grab active:cursor-grabbing hover:bg-ink-800/50 ${
                    isSelected ? "bg-accent/5" : ""
                  }`}
                  onDoubleClick={() => onOpenEntry(entry)}
                  onContextMenu={(e) => openMenu(e, entry)}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    const t = e.target as HTMLElement;
                    if (t.closest("input")) return;
                    onRowPointerDown?.(e, entry);
                  }}
                  onClick={() => onOpenEntry(entry)}
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      className="accent-accent"
                      checked={isSelected}
                      onChange={() => onToggle(entry.key)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex max-w-md items-center gap-2 text-left">
                      {entry.isFolder ? (
                        <Folder size={16} className="shrink-0 text-accent" />
                      ) : (
                        <File size={16} className="shrink-0 text-mist-400" />
                      )}
                      <span className="truncate font-medium text-mist-100">
                        {entry.name}
                      </span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-mist-400">
                    {entry.isFolder ? "—" : formatBytes(entry.size)}
                  </td>
                  {!compact && (
                    <td className="whitespace-nowrap px-3 py-2 text-mist-400">
                      {formatDate(entry.lastModified)}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ContextMenu
        open={!!menu}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        onClose={() => setMenu(null)}
        header={
          <div className="flex items-center gap-2 truncate">
            {menu?.entry.isFolder ? (
              <Folder size={14} className="shrink-0 text-accent" />
            ) : (
              <File size={14} className="shrink-0 text-mist-400" />
            )}
            <span className="truncate">{menu?.entry.name}</span>
          </div>
        }
        info={infoRows}
        items={menuItems}
      />
    </div>
  );
}
