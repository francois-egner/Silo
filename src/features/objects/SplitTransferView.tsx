import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "../../lib/tauri";
import type { ObjectEntry } from "../../shared/types";
import { useUiStore } from "../../shared/store";
import { collectS3KeysUnderPrefix } from "./CopyToModal";
import { LocalPane } from "./LocalPane";
import { S3Pane, type LocalDragPayload, type S3DragPayload } from "./S3Pane";
import { getInAppDrag, setInAppDrag, type InAppDrag } from "./dnd";

export function SplitTransferView({
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
  onUploaded,
  onSelectOnly,
  contextActions,
}: {
  accountId: string;
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
  onUploaded: () => void;
  onSelectOnly?: (key: string) => void;
  contextActions?: import("./S3Pane").S3ContextActions;
}) {
  const showToast = useUiStore((s) => s.showToast);
  const localPath = useUiStore((s) => s.localPath);
  const [drag, setDrag] = useState<InAppDrag | null>(null);
  const [dropTarget, setDropTarget] = useState<"local" | "s3" | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<InAppDrag | null>(null);
  const localPaneRef = useRef<HTMLDivElement>(null);
  const s3PaneRef = useRef<HTMLDivElement>(null);
  const startPos = useRef<{ x: number; y: number } | null>(null);
  const armed = useRef(false);

  const uploadPaths = useCallback(
    async (paths: string[]) => {
      if (!paths.length) return;
      try {
        const expanded = await api.expandLocalFiles(paths);
        if (!expanded.length) {
          showToast("No files to upload", "info");
          return;
        }
        const items = expanded.map((f) => ({
          localPath: f.localPath,
          key: `${prefix}${f.relativeKey}`,
        }));
        await api.uploadObjects(accountId, bucket, items);
        onUploaded();
        showToast(`Uploaded ${items.length} file(s)`, "ok");
      } catch (e) {
        showToast(String(e), "err");
      }
    },
    [accountId, bucket, prefix, onUploaded, showToast],
  );

  const downloadEntries = useCallback(
    async (payload: S3DragPayload) => {
      if (!localPath) {
        showToast("No local folder selected", "err");
        return;
      }
      const destRoot = localPath.replace(/\/$/, "");
      const items: { key: string; localPath: string }[] = [];
      const srcAccount = payload.accountId;
      const srcBucket = payload.bucket;

      for (const e of payload.entries) {
        if (e.isFolder) {
          const nested = await collectS3KeysUnderPrefix(
            srcAccount,
            srcBucket,
            e.key,
          );
          for (const key of nested) {
            const rel = key.startsWith(e.key)
              ? `${e.name}/${key.slice(e.key.length)}`
              : `${e.name}/${key.split("/").pop() ?? key}`;
            items.push({
              key,
              localPath: `${destRoot}/${rel}`,
            });
          }
        } else {
          items.push({
            key: e.key,
            localPath: `${destRoot}/${e.name}`,
          });
        }
      }

      if (!items.length) {
        showToast("Nothing to download", "info");
        return;
      }
      try {
        await api.downloadObjects(srcAccount, srcBucket, items);
        showToast(`Download started (${items.length})`, "ok");
      } catch (err) {
        showToast(String(err), "err");
      }
    },
    [localPath, showToast],
  );

  const hitTarget = useCallback((x: number, y: number): "local" | "s3" | null => {
    const local = localPaneRef.current?.getBoundingClientRect();
    const s3 = s3PaneRef.current?.getBoundingClientRect();
    if (s3 && x >= s3.left && x <= s3.right && y >= s3.top && y <= s3.bottom) {
      return "s3";
    }
    if (
      local &&
      x >= local.left &&
      x <= local.right &&
      y >= local.top &&
      y <= local.bottom
    ) {
      return "local";
    }
    return null;
  }, []);

  const finishDrag = useCallback(
    (x: number, y: number) => {
      const current = dragRef.current ?? getInAppDrag();
      const target = hitTarget(x, y);
      dragRef.current = null;
      setInAppDrag(null);
      setDrag(null);
      setDropTarget(null);
      setCursor(null);
      startPos.current = null;
      armed.current = false;

      if (!current || !target) return;
      if (current.source === "local" && target === "s3") {
        void uploadPaths(current.payload.paths);
      } else if (current.source === "s3" && target === "local") {
        void downloadEntries(current.payload);
      }
    },
    [downloadEntries, hitTarget, uploadPaths],
  );

  // Global pointer tracking while an in-app drag is armed/active
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!startPos.current) return;
      const dx = e.clientX - startPos.current.x;
      const dy = e.clientY - startPos.current.y;
      if (!armed.current) {
        if (Math.hypot(dx, dy) < 6) return;
        armed.current = true;
        setDrag(dragRef.current);
      }
      setCursor({ x: e.clientX, y: e.clientY });
      const target = hitTarget(e.clientX, e.clientY);
      const source = dragRef.current?.source;
      if (source === "local" && target === "s3") setDropTarget("s3");
      else if (source === "s3" && target === "local") setDropTarget("local");
      else setDropTarget(null);
    };

    const onUp = (e: PointerEvent) => {
      if (!startPos.current) return;
      if (armed.current) {
        finishDrag(e.clientX, e.clientY);
      } else {
        // Click without drag — cancel
        dragRef.current = null;
        setInAppDrag(null);
        startPos.current = null;
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [finishDrag, hitTarget]);

  // OS Finder/Explorer drops onto S3 pane (Tauri native DnD)
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        const win = getCurrentWindow();
        const factor = await win.scaleFactor();
        unlisten = await win.onDragDropEvent((event) => {
          if (dragRef.current) return;
          const pane = s3PaneRef.current;
          if (!pane) return;

          const hit = (position: { x: number; y: number }) => {
            const rect = pane.getBoundingClientRect();
            const x = position.x / factor;
            const y = position.y / factor;
            return (
              x >= rect.left &&
              x <= rect.right &&
              y >= rect.top &&
              y <= rect.bottom
            );
          };

          if (event.payload.type === "enter" || event.payload.type === "over") {
            if (hit(event.payload.position)) setDropTarget("s3");
            else setDropTarget((t) => (t === "s3" ? null : t));
          } else if (event.payload.type === "leave") {
            setDropTarget(null);
          } else if (event.payload.type === "drop") {
            const over = hit(event.payload.position);
            setDropTarget(null);
            if (over && event.payload.paths?.length) {
              void uploadPaths(event.payload.paths);
            }
          }
        });
      } catch {
        /* not in Tauri */
      }
    })();
    return () => {
      unlisten?.();
    };
  }, [uploadPaths]);

  function beginLocalPointerDrag(
    e: React.PointerEvent,
    paths: string[],
    label: string,
  ) {
    if (e.button !== 0) return;
    const next: InAppDrag = {
      source: "local",
      payload: { paths } satisfies LocalDragPayload,
      label,
    };
    dragRef.current = next;
    setInAppDrag(next);
    startPos.current = { x: e.clientX, y: e.clientY };
    armed.current = false;
  }

  function beginS3PointerDrag(e: React.PointerEvent, entry: ObjectEntry) {
    if (e.button !== 0) return;
    const keys = selected.has(entry.key) ? [...selected] : [entry.key];
    const selectedEntries = entries.filter((x) => keys.includes(x.key));
    const list = selectedEntries.length ? selectedEntries : [entry];
    const payload: S3DragPayload = {
      accountId,
      bucket,
      keys,
      entries: list.map((x) => ({
        key: x.key,
        name: x.name,
        isFolder: x.isFolder,
      })),
    };
    const next: InAppDrag = {
      source: "s3",
      payload,
      label:
        list.length === 1
          ? list[0].name
          : `${list.length} objects`,
    };
    dragRef.current = next;
    setInAppDrag(next);
    startPos.current = { x: e.clientX, y: e.clientY };
    armed.current = false;
  }

  return (
    <div className="relative flex h-full min-h-0 select-none">
      <div ref={localPaneRef} className="min-w-0 flex-1 border-r border-line">
        <LocalPane
          dropActive={dropTarget === "local" && drag?.source === "s3"}
          onRowPointerDown={beginLocalPointerDrag}
          onUploadToS3={(paths) => void uploadPaths(paths)}
          compact
        />
      </div>
      <div ref={s3PaneRef} className="min-w-0 flex-1">
        <S3Pane
          accountId={accountId}
          bucket={bucket}
          prefix={prefix}
          onPrefixChange={onPrefixChange}
          entries={entries}
          loading={loading}
          error={error}
          selected={selected}
          onToggle={onToggle}
          onSelectAll={onSelectAll}
          onClearSelection={onClearSelection}
          onOpenEntry={onOpenEntry}
          onSelectOnly={onSelectOnly}
          contextActions={{
            ...contextActions,
            onDownload: (ents) => {
              // Prefer downloading into the current local pane folder
              if (localPath) {
                void downloadEntries({
                  accountId,
                  bucket,
                  keys: ents.map((e) => e.key),
                  entries: ents.map((e) => ({
                    key: e.key,
                    name: e.name,
                    isFolder: e.isFolder,
                  })),
                });
                return;
              }
              contextActions?.onDownload?.(ents);
            },
          }}
          compact
          dropActive={dropTarget === "s3" && (drag?.source === "local" || !drag)}
          onRowPointerDown={beginS3PointerDrag}
        />
      </div>

      {drag && cursor && (
        <div
          className="pointer-events-none fixed z-50 max-w-xs truncate rounded-lg border border-accent/40 bg-panel px-3 py-1.5 text-xs font-medium text-fg shadow-xl"
          style={{ left: cursor.x + 12, top: cursor.y + 12 }}
        >
          {drag.source === "local" ? "↑ " : "↓ "}
          {drag.label}
        </div>
      )}
    </div>
  );
}
