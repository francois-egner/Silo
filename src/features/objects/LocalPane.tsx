import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { File, Folder, Home } from "lucide-react";
import { api, formatBytes, formatDate } from "../../lib/tauri";
import type { LocalEntry, LocalStat } from "../../shared/types";
import { useUiStore } from "../../shared/store";
import { Spinner } from "../../shared/ui";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import {
  SortHeader,
  sortEntries,
  toggleSort,
  type SortState,
} from "./sort";

export function LocalPane({
  dropActive,
  onRowPointerDown,
  onUploadToS3,
  compact,
}: {
  dropActive?: boolean;
  onRowPointerDown?: (
    e: React.PointerEvent,
    paths: string[],
    label: string,
  ) => void;
  onUploadToS3?: (paths: string[]) => void;
  compact?: boolean;
}) {
  const localPath = useUiStore((s) => s.localPath);
  const setLocalPath = useUiStore((s) => s.setLocalPath);
  const showToast = useUiStore((s) => s.showToast);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const pointerOrigin = useRef<{ x: number; y: number } | null>(null);
  const didDrag = useRef(false);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    entry: LocalEntry;
  } | null>(null);
  const [stat, setStat] = useState<LocalStat | null>(null);
  const [statLoading, setStatLoading] = useState(false);
  const [sort, setSort] = useState<SortState>({ key: "name", dir: "asc" });

  useEffect(() => {
    if (localPath) return;
    void api.getHomeDir().then(setLocalPath).catch(() => {});
  }, [localPath, setLocalPath]);

  useEffect(() => {
    setSelected(new Set());
  }, [localPath]);

  useEffect(() => {
    if (!menu) {
      setStat(null);
      return;
    }
    let cancelled = false;
    setStatLoading(true);
    void api
      .statLocalPath(menu.entry.path)
      .then((s) => {
        if (!cancelled) setStat(s);
      })
      .catch(() => {
        if (!cancelled) setStat(null);
      })
      .finally(() => {
        if (!cancelled) setStatLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [menu]);

  const listing = useQuery({
    queryKey: ["local-dir", localPath],
    queryFn: () => api.listLocalDir(localPath!),
    enabled: !!localPath,
    retry: false,
  });

  const crumbs = useMemo(() => {
    if (!localPath) return [];
    const parts = localPath.split("/").filter(Boolean);
    const items: { label: string; path: string }[] = [];
    let acc = "";
    for (const p of parts) {
      acc += `/${p}`;
      items.push({ label: p, path: acc });
    }
    return items;
  }, [localPath]);

  const sortedEntries = useMemo(
    () =>
      sortEntries(listing.data ?? [], sort, {
        isDir: (e) => e.isDir,
        name: (e) => e.name,
        size: (e) => e.size,
        modified: (e) => e.modified,
      }),
    [listing.data, sort],
  );

  function toggle(path: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function onOpen(entry: LocalEntry) {
    if (didDrag.current) {
      didDrag.current = false;
      return;
    }
    if (entry.isDir) {
      setLocalPath(entry.path);
      return;
    }
    toggle(entry.path);
  }

  function openMenu(e: React.MouseEvent, entry: LocalEntry) {
    e.preventDefault();
    e.stopPropagation();
    if (!selected.has(entry.path)) {
      setSelected(new Set([entry.path]));
    }
    setMenu({ x: e.clientX, y: e.clientY, entry });
  }

  const menuPaths = menu
    ? selected.has(menu.entry.path)
      ? [...selected]
      : [menu.entry.path]
    : [];

  const infoRows = (() => {
    if (!menu) return [];
    const e = menu.entry;
    const rows: { label: string; value: string }[] = [
      { label: "Name", value: e.name },
      { label: "Type", value: e.isDir ? "Folder" : "File" },
      { label: "Path", value: e.path },
    ];
    if (statLoading) {
      rows.push({ label: "Size", value: "Calculating…" });
    } else if (stat) {
      rows.push({ label: "Size", value: formatBytes(stat.size) });
      if (stat.isDir) {
        rows.push({
          label: "Contains",
          value: `${stat.fileCount} file${stat.fileCount === 1 ? "" : "s"}, ${stat.dirCount} folder${stat.dirCount === 1 ? "" : "s"}`,
        });
      }
      rows.push({ label: "Modified", value: formatDate(stat.modified) });
    } else {
      rows.push({
        label: "Size",
        value: e.isDir ? "—" : formatBytes(e.size),
      });
      rows.push({ label: "Modified", value: formatDate(e.modified) });
    }
    return rows;
  })();

  const menuItems: ContextMenuItem[] = menu
    ? [
        ...(menu.entry.isDir
          ? [
              {
                kind: "action" as const,
                id: "open",
                label: "Open",
                onSelect: () => setLocalPath(menu.entry.path),
              },
            ]
          : []),
        {
          kind: "action",
          id: "upload",
          label:
            menuPaths.length > 1
              ? `Upload ${menuPaths.length} items to S3`
              : menu.entry.isDir
                ? "Upload folder to S3"
                : "Upload to S3",
          disabled: !onUploadToS3,
          onSelect: () => onUploadToS3?.(menuPaths),
        },
        {
          kind: "action",
          id: "copy-path",
          label: "Copy path",
          onSelect: async () => {
            try {
              await navigator.clipboard.writeText(menu.entry.path);
              showToast("Path copied", "ok");
            } catch (err) {
              showToast(String(err), "err");
            }
          },
        },
        { kind: "sep" },
        {
          kind: "action",
          id: "reveal",
          label: "Refresh folder",
          onSelect: () => {
            void listing.refetch();
          },
        },
      ]
    : [];

  return (
    <div
      className="relative flex h-full min-w-0 flex-col"
      onContextMenu={(e) => {
        // Prevent native OS menu on empty pane chrome
        if ((e.target as HTMLElement).closest("tr")) return;
        e.preventDefault();
      }}
    >
      {dropActive && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-30 rounded-sm bg-selected-muted shadow-[inset_0_0_0_2px_var(--accent)]"
        />
      )}
      <nav className="relative z-0 flex h-8 shrink-0 items-center gap-1 overflow-hidden border-b border-line bg-panel px-2 text-[12px]">
        <span className="mr-1 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted">
          Local
        </span>
        <button
          type="button"
          className="shrink-0 rounded p-1 text-muted hover:bg-hover hover:text-fg"
          title="Home"
          onClick={() => void api.getHomeDir().then(setLocalPath)}
        >
          <Home size={14} />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
          {crumbs.map((c, i) => {
            const isLast = i === crumbs.length - 1;
            return (
              <span
                key={c.path}
                className={`flex items-center gap-1 ${isLast ? "min-w-0" : "shrink-0"}`}
              >
                {i > 0 && <span className="shrink-0 text-muted">/</span>}
                <button
                  type="button"
                  title={c.label}
                  className={`rounded px-1.5 py-0.5 hover:bg-hover ${
                    isLast
                      ? "min-w-0 truncate font-medium text-fg"
                      : "max-w-[9rem] truncate text-muted"
                  }`}
                  onClick={() => setLocalPath(c.path)}
                >
                  {c.label}
                </button>
              </span>
            );
          })}
        </div>
      </nav>

      <div className="flex-1 overflow-auto bg-panel">
        {!localPath || listing.isLoading ? (
          <div className="flex justify-center py-16">
            <Spinner className="h-6 w-6" />
          </div>
        ) : null}
        {listing.isError && (
          <div className="m-3 rounded-md border border-danger/30 bg-danger/10 p-3 text-[13px] text-danger">
            {String(listing.error)}
          </div>
        )}
        {listing.data && listing.data.length === 0 && (
          <div className="py-16 text-center text-[13px] text-muted">
            This folder is empty.
          </div>
        )}

        <table className="w-full text-[13px]">
          <thead className="sticky top-0 z-10 bg-toolbar text-left text-[11px] uppercase tracking-wide text-muted">
            <tr>
              <th className="w-9 px-2 py-1.5">
                <input
                  type="checkbox"
                  className="accent-accent"
                  checked={
                    !!listing.data?.length &&
                    listing.data.every((e) => selected.has(e.path))
                  }
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelected(
                        new Set(listing.data?.map((x) => x.path) ?? []),
                      );
                    } else setSelected(new Set());
                  }}
                />
              </th>
              <SortHeader
                label="Name"
                column="name"
                sort={sort}
                onSort={(key) => setSort((s) => toggleSort(s, key))}
                className="px-2 py-1.5"
              />
              <SortHeader
                label="Size"
                column="size"
                sort={sort}
                onSort={(key) => setSort((s) => toggleSort(s, key))}
                className="w-24 px-2 py-1.5"
              />
              {!compact && (
                <SortHeader
                  label="Modified"
                  column="modified"
                  sort={sort}
                  onSort={(key) => setSort((s) => toggleSort(s, key))}
                  className="w-40 px-2 py-1.5"
                />
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sortedEntries.map((entry) => {
              const isSelected = selected.has(entry.path);
              return (
                <tr
                  key={entry.path}
                  className={`cursor-grab active:cursor-grabbing hover:bg-hover ${
                    isSelected ? "bg-selected-muted" : ""
                  }`}
                  onDoubleClick={() => {
                    if (entry.isDir) setLocalPath(entry.path);
                  }}
                  onContextMenu={(e) => openMenu(e, entry)}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    const t = e.target as HTMLElement;
                    if (t.closest("input")) return;
                    pointerOrigin.current = { x: e.clientX, y: e.clientY };
                    didDrag.current = false;
                    const paths = selected.has(entry.path)
                      ? [...selected]
                      : [entry.path];
                    const label =
                      paths.length === 1
                        ? entry.name
                        : `${paths.length} items`;
                    onRowPointerDown?.(e, paths, label);
                  }}
                  onPointerMove={(e) => {
                    if (!pointerOrigin.current || didDrag.current) return;
                    const dx = e.clientX - pointerOrigin.current.x;
                    const dy = e.clientY - pointerOrigin.current.y;
                    if (Math.hypot(dx, dy) >= 6) didDrag.current = true;
                  }}
                  onClick={() => onOpen(entry)}
                >
                  <td className="px-2 py-1">
                    <input
                      type="checkbox"
                      className="accent-accent"
                      checked={isSelected}
                      onChange={() => toggle(entry.path)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <div className="flex max-w-md items-center gap-2 text-left">
                      {entry.isDir ? (
                        <Folder size={14} className="shrink-0 text-muted" />
                      ) : (
                        <File size={14} className="shrink-0 text-muted" />
                      )}
                      <span className="truncate font-medium text-fg">
                        {entry.name}
                      </span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1 font-mono text-muted">
                    {entry.isDir ? "—" : formatBytes(entry.size)}
                  </td>
                  {!compact && (
                    <td className="whitespace-nowrap px-2 py-1 text-muted">
                      {formatDate(entry.modified)}
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
            {menu?.entry.isDir ? (
              <Folder size={14} className="shrink-0 text-muted" />
            ) : (
              <File size={14} className="shrink-0 text-muted" />
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
