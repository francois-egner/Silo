import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/tauri";
import { filterVisibleBuckets } from "../../shared/buckets";
import type { ObjectEntry } from "../../shared/types";
import { useUiStore } from "../../shared/store";
import { Select, Spinner } from "../../shared/ui";
import { buildCopyItems } from "./CopyToModal";
import { S3Pane, type S3DragPayload } from "./S3Pane";
import { getInAppDrag, setInAppDrag, type InAppDrag } from "./dnd";

export function S3SplitTransferView({
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
  onSelectOnly,
  contextActions,
  onCopied,
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
  onSelectOnly?: (key: string) => void;
  contextActions?: import("./S3Pane").S3ContextActions;
  onCopied?: () => void;
}) {
  const showToast = useUiStore((s) => s.showToast);
  const qc = useQueryClient();
  const destAccountId = useUiStore((s) => s.s3s3DestAccountId);
  const destBucket = useUiStore((s) => s.s3s3DestBucket);
  const destPrefix = useUiStore((s) => s.s3s3DestPrefix);
  const setS3s3Dest = useUiStore((s) => s.setS3s3Dest);

  const [drag, setDrag] = useState<InAppDrag | null>(null);
  const [dropTarget, setDropTarget] = useState<"left" | "right" | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [rightSelected, setRightSelected] = useState<Set<string>>(new Set());
  const dragRef = useRef<InAppDrag | null>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const startPos = useRef<{ x: number; y: number } | null>(null);
  const armed = useRef(false);

  const accounts = useQuery({ queryKey: ["accounts"], queryFn: api.listAccounts });

  useEffect(() => {
    if (!destAccountId) {
      setS3s3Dest({ accountId, bucket, prefix: "" });
    }
  }, [accountId, bucket, destAccountId, setS3s3Dest]);

  const effectiveDestAccount = destAccountId ?? accountId;
  const destAccount = accounts.data?.find((a) => a.id === effectiveDestAccount);

  const destBuckets = useQuery({
    queryKey: ["buckets", effectiveDestAccount],
    queryFn: () => api.listBuckets(effectiveDestAccount),
    enabled: !!effectiveDestAccount,
  });

  const visibleDestBuckets = useMemo(
    () => filterVisibleBuckets(destAccount, destBuckets.data ?? []),
    [destAccount, destBuckets.data],
  );

  const effectiveDestBucket =
    destBucket && visibleDestBuckets.some((b) => b.name === destBucket)
      ? destBucket
      : (visibleDestBuckets[0]?.name ?? bucket);

  useEffect(() => {
    if (destBucket !== effectiveDestBucket) {
      setS3s3Dest({ bucket: effectiveDestBucket });
    }
  }, [destBucket, effectiveDestBucket, setS3s3Dest]);

  const destObjects = useQuery({
    queryKey: ["objects", effectiveDestAccount, effectiveDestBucket, destPrefix],
    queryFn: () =>
      api.listObjects(effectiveDestAccount, effectiveDestBucket, destPrefix),
    enabled: !!effectiveDestAccount && !!effectiveDestBucket,
  });

  useEffect(() => {
    setRightSelected(new Set());
  }, [destPrefix, effectiveDestBucket, effectiveDestAccount]);

  const copyPayloadTo = useCallback(
    async (
      payload: S3DragPayload,
      destAcc: string,
      destBkt: string,
      destPfx: string,
    ) => {
      try {
        const items = await buildCopyItems(
          payload.accountId,
          payload.bucket,
          payload.entries,
          destPfx,
        );
        if (!items.length) {
          showToast("Nothing to copy", "info");
          return;
        }
        if (
          payload.accountId === destAcc &&
          payload.bucket === destBkt &&
          items.every((i) => i.sourceKey === i.destKey)
        ) {
          showToast("Same location — nothing to copy", "info");
          return;
        }
        await api.copyObjects(
          payload.accountId,
          payload.bucket,
          destAcc,
          destBkt,
          items,
          false,
        );
        await qc.invalidateQueries({
          queryKey: ["objects", destAcc, destBkt],
        });
        onCopied?.();
        showToast(`Copy started (${items.length})`, "ok");
      } catch (e) {
        showToast(String(e), "err");
      }
    },
    [onCopied, qc, showToast],
  );

  const hitTarget = useCallback((x: number, y: number): "left" | "right" | null => {
    const left = leftRef.current?.getBoundingClientRect();
    const right = rightRef.current?.getBoundingClientRect();
    if (
      right &&
      x >= right.left &&
      x <= right.right &&
      y >= right.top &&
      y <= right.bottom
    ) {
      return "right";
    }
    if (
      left &&
      x >= left.left &&
      x <= left.right &&
      y >= left.top &&
      y <= left.bottom
    ) {
      return "left";
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

      if (!current || current.source !== "s3" || !target) return;
      const payload = current.payload;

      if (target === "right") {
        if (
          payload.accountId === effectiveDestAccount &&
          payload.bucket === effectiveDestBucket
        ) {
          // Allow copy into different prefix of same bucket
        }
        void copyPayloadTo(
          payload,
          effectiveDestAccount,
          effectiveDestBucket,
          destPrefix,
        );
      } else if (target === "left") {
        void copyPayloadTo(payload, accountId, bucket, prefix);
      }
    },
    [
      accountId,
      bucket,
      copyPayloadTo,
      destPrefix,
      effectiveDestAccount,
      effectiveDestBucket,
      hitTarget,
      prefix,
    ],
  );

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
      const src = dragRef.current;
      if (src?.source !== "s3") {
        setDropTarget(null);
        return;
      }
      // Highlight opposite pane only
      if (target === "right" && src.payload.bucket) setDropTarget("right");
      else if (target === "left") setDropTarget("left");
      else setDropTarget(null);
    };

    const onUp = (e: PointerEvent) => {
      if (!startPos.current) return;
      if (armed.current) {
        finishDrag(e.clientX, e.clientY);
      } else {
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

  function beginS3Drag(
    e: React.PointerEvent,
    entry: ObjectEntry,
    side: "left" | "right",
    paneAccount: string,
    paneBucket: string,
    paneEntries: ObjectEntry[],
    paneSelected: Set<string>,
  ) {
    if (e.button !== 0) return;
    const keys = paneSelected.has(entry.key)
      ? [...paneSelected]
      : [entry.key];
    const selectedEntries = paneEntries.filter((x) => keys.includes(x.key));
    const list = selectedEntries.length ? selectedEntries : [entry];
    const payload: S3DragPayload = {
      accountId: paneAccount,
      bucket: paneBucket,
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
      label: list.length === 1 ? list[0].name : `${list.length} objects`,
    };
    dragRef.current = next;
    setInAppDrag(next);
    startPos.current = { x: e.clientX, y: e.clientY };
    armed.current = false;
    void side;
  }

  function openDestEntry(entry: ObjectEntry) {
    if (entry.isFolder) {
      setS3s3Dest({ prefix: entry.key });
    }
  }

  return (
    <div className="relative flex h-full min-h-0 select-none flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-toolbar px-3 py-2">
        <span className="text-[11px] uppercase tracking-wide text-muted">
          Destination
        </span>
        <Select
          className="max-w-[160px] py-1 text-xs"
          value={effectiveDestAccount}
          onChange={(e) =>
            setS3s3Dest({ accountId: e.target.value, bucket: null, prefix: "" })
          }
        >
          {(accounts.data ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        <Select
          className="max-w-[200px] py-1 text-xs"
          value={effectiveDestBucket}
          onChange={(e) => setS3s3Dest({ bucket: e.target.value, prefix: "" })}
          disabled={!visibleDestBuckets.length}
        >
          {visibleDestBuckets.map((b) => (
            <option key={b.name} value={b.name}>
              {b.name}
            </option>
          ))}
        </Select>
        {destBuckets.isLoading && (
          <Spinner className="h-3.5 w-3.5 text-muted" />
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        <div ref={leftRef} className="min-w-0 flex-1 border-r border-line">
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
            contextActions={contextActions}
            compact
            dropActive={dropTarget === "left" && drag?.source === "s3"}
            onRowPointerDown={(e, entry) =>
              beginS3Drag(
                e,
                entry,
                "left",
                accountId,
                bucket,
                entries,
                selected,
              )
            }
          />
        </div>
        <div ref={rightRef} className="min-w-0 flex-1">
          <S3Pane
            accountId={effectiveDestAccount}
            bucket={effectiveDestBucket}
            prefix={destPrefix}
            onPrefixChange={(p) => setS3s3Dest({ prefix: p })}
            entries={destObjects.data?.entries ?? []}
            loading={destObjects.isLoading}
            error={destObjects.error}
            selected={rightSelected}
            onToggle={(key) =>
              setRightSelected((prev) => {
                const next = new Set(prev);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              })
            }
            onSelectAll={() =>
              setRightSelected(
                new Set(destObjects.data?.entries.map((e) => e.key) ?? []),
              )
            }
            onClearSelection={() => setRightSelected(new Set())}
            onOpenEntry={openDestEntry}
            onSelectOnly={(key) => setRightSelected(new Set([key]))}
            contextActions={{
              onCopyTo: contextActions?.onCopyTo,
              onMoveTo: contextActions?.onMoveTo,
              onDelete: async (keys) => {
                if (!confirm(`Delete ${keys.length} item(s)?`)) return;
                try {
                  await api.deleteObjects(
                    effectiveDestAccount,
                    effectiveDestBucket,
                    keys,
                  );
                  await qc.invalidateQueries({
                    queryKey: [
                      "objects",
                      effectiveDestAccount,
                      effectiveDestBucket,
                    ],
                  });
                  showToast("Deleted", "ok");
                } catch (err) {
                  showToast(String(err), "err");
                }
              },
            }}
            compact
            dropActive={dropTarget === "right" && drag?.source === "s3"}
            onRowPointerDown={(e, entry) =>
              beginS3Drag(
                e,
                entry,
                "right",
                effectiveDestAccount,
                effectiveDestBucket,
                destObjects.data?.entries ?? [],
                rightSelected,
              )
            }
          />
        </div>
      </div>

      {drag && cursor && (
        <div
          className="pointer-events-none fixed z-50 max-w-xs truncate rounded-lg border border-accent/40 bg-panel px-3 py-1.5 text-xs font-medium text-fg shadow-xl"
          style={{ left: cursor.x + 12, top: cursor.y + 12 }}
        >
          → {drag.label}
        </div>
      )}
    </div>
  );
}
