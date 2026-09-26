import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { Copy } from "lucide-react";
import { api } from "../../lib/tauri";
import { filterVisibleBuckets } from "../../shared/buckets";
import type { ObjectEntry } from "../../shared/types";
import { useUiStore } from "../../shared/store";
import { Button, Field, Input, Modal, Select, Spinner } from "../../shared/ui";
import { buildCopyItems } from "./CopyToModal";
import { S3Pane, type S3DragPayload, type S3ContextActions } from "./S3Pane";
import { getInAppDrag, setInAppDrag, type InAppDrag } from "./dnd";

function fileName(path: string) {
  return path.split(/[/\\]/).pop() ?? path;
}

function PaneLocationBar({
  label,
  accountId,
  bucket,
  accounts,
  buckets,
  bucketsLoading,
  onAccountChange,
  onBucketChange,
}: {
  label: string;
  accountId: string;
  bucket: string;
  accounts: { id: string; name: string }[];
  buckets: { name: string }[];
  bucketsLoading: boolean;
  onAccountChange: (accountId: string) => void;
  onBucketChange: (bucket: string) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-line bg-toolbar px-3 py-2">
      <span className="shrink-0 text-[11px] uppercase tracking-wide text-muted">
        {label}
      </span>
      <Select
        className="max-w-[160px] py-1 text-xs"
        value={accountId}
        onChange={(e) => onAccountChange(e.target.value)}
      >
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </Select>
      <Select
        className="min-w-0 flex-1 py-1 text-xs"
        value={bucket}
        onChange={(e) => onBucketChange(e.target.value)}
        disabled={!buckets.length}
      >
        {buckets.map((b) => (
          <option key={b.name} value={b.name}>
            {b.name}
          </option>
        ))}
      </Select>
      {bucketsLoading && <Spinner className="h-3.5 w-3.5 shrink-0 text-muted" />}
    </div>
  );
}

export function S3SplitTransferView({
  accountId,
  bucket,
  contextActions,
  onCopied,
}: {
  /** Open browser location — used to seed source/dest when unset. */
  accountId: string;
  bucket: string;
  contextActions?: S3ContextActions;
  onCopied?: () => void;
}) {
  const showToast = useUiStore((s) => s.showToast);
  const qc = useQueryClient();

  const sourceAccountId = useUiStore((s) => s.s3s3SourceAccountId);
  const sourceBucket = useUiStore((s) => s.s3s3SourceBucket);
  const sourcePrefix = useUiStore((s) => s.s3s3SourcePrefix);
  const setS3s3Source = useUiStore((s) => s.setS3s3Source);

  const destAccountId = useUiStore((s) => s.s3s3DestAccountId);
  const destBucket = useUiStore((s) => s.s3s3DestBucket);
  const destPrefix = useUiStore((s) => s.s3s3DestPrefix);
  const setS3s3Dest = useUiStore((s) => s.setS3s3Dest);

  const [drag, setDrag] = useState<InAppDrag | null>(null);
  const [dropTarget, setDropTarget] = useState<"left" | "right" | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [leftSelected, setLeftSelected] = useState<Set<string>>(new Set());
  const [rightSelected, setRightSelected] = useState<Set<string>>(new Set());
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [folderTarget, setFolderTarget] = useState<"left" | "right">("left");
  const [folderPending, setFolderPending] = useState(false);
  const dragRef = useRef<InAppDrag | null>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const startPos = useRef<{ x: number; y: number } | null>(null);
  const armed = useRef(false);

  const accounts = useQuery({ queryKey: ["accounts"], queryFn: api.listAccounts });

  useEffect(() => {
    if (!sourceAccountId) {
      setS3s3Source({ accountId, bucket, prefix: "" });
    }
  }, [accountId, bucket, sourceAccountId, setS3s3Source]);

  useEffect(() => {
    if (!destAccountId) {
      setS3s3Dest({ accountId, bucket, prefix: "" });
    }
  }, [accountId, bucket, destAccountId, setS3s3Dest]);

  const effectiveSourceAccount = sourceAccountId ?? accountId;
  const effectiveDestAccount = destAccountId ?? accountId;

  const sourceAccount = accounts.data?.find((a) => a.id === effectiveSourceAccount);
  const destAccount = accounts.data?.find((a) => a.id === effectiveDestAccount);

  const sourceBuckets = useQuery({
    queryKey: ["buckets", effectiveSourceAccount],
    queryFn: () => api.listBuckets(effectiveSourceAccount),
    enabled: !!effectiveSourceAccount,
  });

  const destBuckets = useQuery({
    queryKey: ["buckets", effectiveDestAccount],
    queryFn: () => api.listBuckets(effectiveDestAccount),
    enabled: !!effectiveDestAccount,
  });

  const visibleSourceBuckets = useMemo(
    () => filterVisibleBuckets(sourceAccount, sourceBuckets.data ?? []),
    [sourceAccount, sourceBuckets.data],
  );

  const visibleDestBuckets = useMemo(
    () => filterVisibleBuckets(destAccount, destBuckets.data ?? []),
    [destAccount, destBuckets.data],
  );

  const effectiveSourceBucket =
    sourceBucket && visibleSourceBuckets.some((b) => b.name === sourceBucket)
      ? sourceBucket
      : (visibleSourceBuckets[0]?.name ?? bucket);

  const effectiveDestBucket =
    destBucket && visibleDestBuckets.some((b) => b.name === destBucket)
      ? destBucket
      : (visibleDestBuckets[0]?.name ?? bucket);

  useEffect(() => {
    if (sourceBucket !== effectiveSourceBucket) {
      setS3s3Source({ bucket: effectiveSourceBucket });
    }
  }, [sourceBucket, effectiveSourceBucket, setS3s3Source]);

  useEffect(() => {
    if (destBucket !== effectiveDestBucket) {
      setS3s3Dest({ bucket: effectiveDestBucket });
    }
  }, [destBucket, effectiveDestBucket, setS3s3Dest]);

  const sourceObjects = useQuery({
    queryKey: [
      "objects",
      effectiveSourceAccount,
      effectiveSourceBucket,
      sourcePrefix,
    ],
    queryFn: () =>
      api.listObjects(
        effectiveSourceAccount,
        effectiveSourceBucket,
        sourcePrefix,
      ),
    enabled: !!effectiveSourceAccount && !!effectiveSourceBucket,
  });

  const destObjects = useQuery({
    queryKey: ["objects", effectiveDestAccount, effectiveDestBucket, destPrefix],
    queryFn: () =>
      api.listObjects(effectiveDestAccount, effectiveDestBucket, destPrefix),
    enabled: !!effectiveDestAccount && !!effectiveDestBucket,
  });

  useEffect(() => {
    setLeftSelected(new Set());
  }, [sourcePrefix, effectiveSourceBucket, effectiveSourceAccount]);

  useEffect(() => {
    setRightSelected(new Set());
  }, [destPrefix, effectiveDestBucket, effectiveDestAccount]);

  const invalidateBoth = useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({
        queryKey: ["objects", effectiveSourceAccount, effectiveSourceBucket],
      }),
      qc.invalidateQueries({
        queryKey: ["objects", effectiveDestAccount, effectiveDestBucket],
      }),
    ]);
    onCopied?.();
  }, [
    effectiveDestAccount,
    effectiveDestBucket,
    effectiveSourceAccount,
    effectiveSourceBucket,
    onCopied,
    qc,
  ]);

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
        await invalidateBoth();
        showToast(`Copy started (${items.length})`, "ok");
      } catch (e) {
        showToast(String(e), "err");
      }
    },
    [invalidateBoth, showToast],
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
        void copyPayloadTo(
          payload,
          effectiveDestAccount,
          effectiveDestBucket,
          destPrefix,
        );
      } else if (target === "left") {
        void copyPayloadTo(
          payload,
          effectiveSourceAccount,
          effectiveSourceBucket,
          sourcePrefix,
        );
      }
    },
    [
      copyPayloadTo,
      destPrefix,
      effectiveDestAccount,
      effectiveDestBucket,
      effectiveSourceAccount,
      effectiveSourceBucket,
      hitTarget,
      sourcePrefix,
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
  }

  function openSourceEntry(entry: ObjectEntry) {
    if (entry.isFolder) {
      setS3s3Source({ prefix: entry.key });
    }
  }

  function openDestEntry(entry: ObjectEntry) {
    if (entry.isFolder) {
      setS3s3Dest({ prefix: entry.key });
    }
  }

  const uploadToPane = useCallback(
    async (paneAccount: string, paneBucket: string, panePrefix: string) => {
      try {
        const selectedPaths = await open({
          multiple: true,
          directory: false,
        });
        if (!selectedPaths) return;
        const paths = Array.isArray(selectedPaths)
          ? selectedPaths
          : [selectedPaths];
        const items = paths.map((localPath) => ({
          localPath,
          key: `${panePrefix}${fileName(localPath)}`,
        }));
        await api.uploadObjects(paneAccount, paneBucket, items);
        await qc.invalidateQueries({
          queryKey: ["objects", paneAccount, paneBucket],
        });
        showToast(`Uploaded ${items.length} file(s)`, "ok");
      } catch (e) {
        showToast(String(e), "err");
      }
    },
    [qc, showToast],
  );

  const createFolderInPane = useCallback(async () => {
    const name = folderName.trim().replace(/^\/+|\/+$/g, "");
    if (!name) return;
    const paneAccount =
      folderTarget === "left" ? effectiveSourceAccount : effectiveDestAccount;
    const paneBucket =
      folderTarget === "left" ? effectiveSourceBucket : effectiveDestBucket;
    const panePrefix =
      folderTarget === "left" ? sourcePrefix : destPrefix;
    setFolderPending(true);
    try {
      await api.createFolder(paneAccount, paneBucket, `${panePrefix}${name}/`);
      await qc.invalidateQueries({
        queryKey: ["objects", paneAccount, paneBucket],
      });
      setFolderOpen(false);
      setFolderName("");
      showToast("Folder created", "ok");
    } catch (e) {
      showToast(String(e), "err");
    } finally {
      setFolderPending(false);
    }
  }, [
    destPrefix,
    effectiveDestAccount,
    effectiveDestBucket,
    effectiveSourceAccount,
    effectiveSourceBucket,
    folderName,
    folderTarget,
    qc,
    showToast,
    sourcePrefix,
  ]);

  function paneBgActions(
    side: "left" | "right",
    paneAccount: string,
    paneBucket: string,
    panePrefix: string,
  ): Pick<S3ContextActions, "onNewFolder" | "onUpload" | "onRefresh"> {
    return {
      onNewFolder: () => {
        setFolderTarget(side);
        setFolderName("");
        setFolderOpen(true);
      },
      onUpload: () => void uploadToPane(paneAccount, paneBucket, panePrefix),
      onRefresh: () =>
        void qc.invalidateQueries({
          queryKey: ["objects", paneAccount, paneBucket, panePrefix],
        }),
    };
  }

  const accountOptions = accounts.data ?? [];
  const sourceEntries = sourceObjects.data?.entries ?? [];
  const destEntries = destObjects.data?.entries ?? [];

  return (
    <div className="relative flex h-full min-h-0 select-none flex-col">
      <div className="flex min-h-0 flex-1">
        <div
          ref={leftRef}
          className="flex min-w-0 flex-1 flex-col border-r border-line"
        >
          <PaneLocationBar
            label="Source"
            accountId={effectiveSourceAccount}
            bucket={effectiveSourceBucket}
            accounts={accountOptions}
            buckets={visibleSourceBuckets}
            bucketsLoading={sourceBuckets.isLoading}
            onAccountChange={(id) =>
              setS3s3Source({ accountId: id, bucket: null, prefix: "" })
            }
            onBucketChange={(name) =>
              setS3s3Source({ bucket: name, prefix: "" })
            }
          />
          <div className="min-h-0 flex-1">
            <S3Pane
              accountId={effectiveSourceAccount}
              bucket={effectiveSourceBucket}
              prefix={sourcePrefix}
              onPrefixChange={(p) => setS3s3Source({ prefix: p })}
              entries={sourceEntries}
              loading={sourceObjects.isLoading}
              error={sourceObjects.error}
              selected={leftSelected}
              onToggle={(key) =>
                setLeftSelected((prev) => {
                  const next = new Set(prev);
                  if (next.has(key)) next.delete(key);
                  else next.add(key);
                  return next;
                })
              }
              onSelectAll={() =>
                setLeftSelected(new Set(sourceEntries.map((e) => e.key)))
              }
              onClearSelection={() => setLeftSelected(new Set())}
              onOpenEntry={openSourceEntry}
              onSelectOnly={(key) => setLeftSelected(new Set([key]))}
              contextActions={{
                onCopyTo: contextActions?.onCopyTo,
                onMoveTo: contextActions?.onMoveTo,
                ...paneBgActions(
                  "left",
                  effectiveSourceAccount,
                  effectiveSourceBucket,
                  sourcePrefix,
                ),
                onDelete: async (keys) => {
                  if (!confirm(`Delete ${keys.length} item(s)?`)) return;
                  try {
                    await api.deleteObjects(
                      effectiveSourceAccount,
                      effectiveSourceBucket,
                      keys,
                    );
                    await qc.invalidateQueries({
                      queryKey: [
                        "objects",
                        effectiveSourceAccount,
                        effectiveSourceBucket,
                      ],
                    });
                    showToast("Deleted", "ok");
                  } catch (err) {
                    showToast(String(err), "err");
                  }
                },
              }}
              compact
              dropActive={dropTarget === "left" && drag?.source === "s3"}
              onRowPointerDown={(e, entry) =>
                beginS3Drag(
                  e,
                  entry,
                  effectiveSourceAccount,
                  effectiveSourceBucket,
                  sourceEntries,
                  leftSelected,
                )
              }
            />
          </div>
        </div>

        <div ref={rightRef} className="flex min-w-0 flex-1 flex-col">
          <PaneLocationBar
            label="Destination"
            accountId={effectiveDestAccount}
            bucket={effectiveDestBucket}
            accounts={accountOptions}
            buckets={visibleDestBuckets}
            bucketsLoading={destBuckets.isLoading}
            onAccountChange={(id) =>
              setS3s3Dest({ accountId: id, bucket: null, prefix: "" })
            }
            onBucketChange={(name) =>
              setS3s3Dest({ bucket: name, prefix: "" })
            }
          />
          <div className="min-h-0 flex-1">
            <S3Pane
              accountId={effectiveDestAccount}
              bucket={effectiveDestBucket}
              prefix={destPrefix}
              onPrefixChange={(p) => setS3s3Dest({ prefix: p })}
              entries={destEntries}
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
                setRightSelected(new Set(destEntries.map((e) => e.key)))
              }
              onClearSelection={() => setRightSelected(new Set())}
              onOpenEntry={openDestEntry}
              onSelectOnly={(key) => setRightSelected(new Set([key]))}
              contextActions={{
                onCopyTo: contextActions?.onCopyTo,
                onMoveTo: contextActions?.onMoveTo,
                ...paneBgActions(
                  "right",
                  effectiveDestAccount,
                  effectiveDestBucket,
                  destPrefix,
                ),
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
                  effectiveDestAccount,
                  effectiveDestBucket,
                  destEntries,
                  rightSelected,
                )
              }
            />
          </div>
        </div>
      </div>

      {drag && cursor && (
        <div
          className="pointer-events-none fixed z-50 flex max-w-xs items-center gap-1.5 truncate rounded-lg border border-accent/40 bg-panel px-3 py-1.5 text-xs font-medium text-fg shadow-xl"
          style={{ left: cursor.x + 12, top: cursor.y + 12 }}
        >
          <Copy size={12} className="shrink-0" />
          <span className="truncate">{drag.label}</span>
        </div>
      )}

      <Modal
        open={folderOpen}
        onClose={() => setFolderOpen(false)}
        title="New folder"
      >
        <Field label="Folder name">
          <Input
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            placeholder="assets"
            onKeyDown={(e) => {
              if (e.key === "Enter" && folderName.trim()) {
                void createFolderInPane();
              }
            }}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setFolderOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={!folderName.trim() || folderPending}
            onClick={() => void createFolderInPane()}
          >
            Create
          </Button>
        </div>
      </Modal>
    </div>
  );
}
