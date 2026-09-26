import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { open, save } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ArrowLeftRight,
  Columns2,
  Copy,
  Download,
  FolderPlus,
  Link2,
  PanelLeft,
  Pencil,
  Trash2,
  Upload,
} from "lucide-react";
import { api } from "../../lib/tauri";
import type {
  BrowserViewMode,
  ObjectEntry,
  TransferProgress,
} from "../../shared/types";
import { useUiStore } from "../../shared/store";
import {
  Button,
  Field,
  Input,
  Modal,
  SegmentedControl,
  Select,
  Toolbar,
  ToolbarButton,
} from "../../shared/ui";
import { CopyToModal } from "./CopyToModal";
import { S3Pane, type S3CopySource } from "./S3Pane";
import { S3SplitTransferView } from "./S3SplitTransferView";
import { SplitTransferView } from "./SplitTransferView";

function fileName(path: string) {
  return path.split(/[/\\]/).pop() ?? path;
}

export function ObjectBrowser({
  accountId,
  bucket,
  prefix,
  onPrefixChange,
  onOpenSettings,
}: {
  accountId: string;
  bucket: string;
  prefix: string;
  onPrefixChange: (prefix: string) => void;
  onOpenSettings: () => void;
}) {
  const qc = useQueryClient();
  const showToast = useUiStore((s) => s.showToast);
  const selected = useUiStore((s) => s.selectedKeys);
  const toggleKey = useUiStore((s) => s.toggleKey);
  const clearSelection = useUiStore((s) => s.clearSelection);
  const setSelectedKeys = useUiStore((s) => s.setSelectedKeys);
  const upsertTransfer = useUiStore((s) => s.upsertTransfer);
  const viewMode = useUiStore((s) => s.viewMode);
  const setViewMode = useUiStore((s) => s.setViewMode);

  const [folderOpen, setFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameKey, setRenameKey] = useState<string | null>(null);
  const [aclOpen, setAclOpen] = useState(false);
  const [aclKey, setAclKey] = useState<string | null>(null);
  const [objectAcl, setObjectAcl] = useState("private");
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyMove, setCopyMove] = useState(false);
  const [copyEntries, setCopyEntries] = useState<ObjectEntry[]>([]);
  const [copySource, setCopySource] = useState<S3CopySource>({
    accountId,
    bucket,
    prefix,
  });

  useEffect(() => {
    clearSelection();
  }, [prefix, bucket, clearSelection]);

  useEffect(() => {
    const un = listen<TransferProgress>("transfer://progress", (e) => {
      upsertTransfer(e.payload);
    });
    return () => {
      void un.then((f) => f());
    };
  }, [upsertTransfer]);

  const objects = useQuery({
    queryKey: ["objects", accountId, bucket, prefix],
    queryFn: () => api.listObjects(accountId, bucket, prefix),
    retry: 1,
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["objects", accountId, bucket, prefix] });

  // OS file drops in single-pane mode
  useEffect(() => {
    if (viewMode !== "single") return;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        unlisten = await getCurrentWindow().onDragDropEvent(async (event) => {
          if (event.payload.type !== "drop" || !event.payload.paths?.length) {
            return;
          }
          try {
            const expanded = await api.expandLocalFiles(event.payload.paths);
            if (!expanded.length) return;
            const items = expanded.map((f) => ({
              localPath: f.localPath,
              key: `${prefix}${f.relativeKey}`,
            }));
            await api.uploadObjects(accountId, bucket, items);
            await invalidate();
            showToast(`Uploaded ${items.length} file(s)`, "ok");
          } catch (e) {
            showToast(String(e), "err");
          }
        });
      } catch {
        /* not in Tauri */
      }
    })();
    return () => {
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, accountId, bucket, prefix]);

  const upload = useMutation({
    mutationFn: async () => {
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
        key: `${prefix}${fileName(localPath)}`,
      }));
      await api.uploadObjects(accountId, bucket, items);
    },
    onSuccess: async () => {
      await invalidate();
      showToast("Upload finished", "ok");
    },
    onError: (e: Error) => showToast(String(e), "err"),
  });

  const download = useMutation({
    mutationFn: async (keys: string[]) => {
      const items = [];
      for (const key of keys) {
        const dest = await save({
          defaultPath: fileName(key),
        });
        if (!dest) continue;
        items.push({ key, localPath: dest });
      }
      if (!items.length) return;
      await api.downloadObjects(accountId, bucket, items);
    },
    onSuccess: () => showToast("Download started", "ok"),
    onError: (e: Error) => showToast(String(e), "err"),
  });

  const remove = useMutation({
    mutationFn: (keys: string[]) => api.deleteObjects(accountId, bucket, keys),
    onSuccess: async () => {
      clearSelection();
      await invalidate();
      showToast("Deleted", "ok");
    },
    onError: (e: Error) => showToast(String(e), "err"),
  });

  const createFolder = useMutation({
    mutationFn: () => {
      const name = folderName.trim().replace(/^\/+|\/+$/g, "");
      return api.createFolder(accountId, bucket, `${prefix}${name}/`);
    },
    onSuccess: async () => {
      setFolderOpen(false);
      setFolderName("");
      await invalidate();
      showToast("Folder created", "ok");
    },
    onError: (e: Error) => showToast(String(e), "err"),
  });

  const rename = useMutation({
    mutationFn: async () => {
      if (!renameKey) return;
      const dest = renameValue.trim();
      if (!dest || dest === renameKey) return;
      await api.copyObject(accountId, bucket, renameKey, dest, true);
    },
    onSuccess: async () => {
      setRenameOpen(false);
      clearSelection();
      await invalidate();
      showToast("Renamed", "ok");
    },
    onError: (e: Error) => showToast(String(e), "err"),
  });

  const selectedEntries = useMemo(() => {
    return (objects.data?.entries ?? []).filter((e) => selected.has(e.key));
  }, [objects.data, selected]);

  const selectedFiles = selectedEntries.filter((e) => !e.isFolder);

  function onOpenEntry(e: ObjectEntry) {
    if (e.isFolder) {
      onPrefixChange(e.key);
      return;
    }
    toggleKey(e.key);
  }

  const listProps = {
    accountId,
    bucket,
    prefix,
    onPrefixChange,
    entries: objects.data?.entries ?? [],
    loading: objects.isLoading,
    error: objects.isError ? (objects.error as Error) : null,
    selected,
    onToggle: toggleKey,
    onSelectAll: () =>
      setSelectedKeys(new Set(objects.data?.entries.map((x) => x.key) ?? [])),
    onClearSelection: clearSelection,
    onOpenEntry,
    onSelectOnly: (key: string) => setSelectedKeys(new Set([key])),
    contextActions: {
      onDownload: (ents: ObjectEntry[]) => {
        void (async () => {
          try {
            const items: { key: string; localPath: string }[] = [];
            for (const ent of ents) {
              if (ent.isFolder) {
                const destDir = await open({
                  directory: true,
                  multiple: false,
                });
                if (!destDir || Array.isArray(destDir)) continue;
                const queue = [ent.key];
                const keys: string[] = [];
                while (queue.length) {
                  const pfx = queue.shift()!;
                  let token: string | null = null;
                  do {
                    const page = await api.listObjects(
                      accountId,
                      bucket,
                      pfx,
                      token,
                    );
                    for (const e of page.entries) {
                      if (e.isFolder) queue.push(e.key);
                      else keys.push(e.key);
                    }
                    token = page.nextContinuationToken;
                  } while (token);
                }
                for (const key of keys) {
                  const rel = key.startsWith(ent.key)
                    ? `${ent.name}/${key.slice(ent.key.length)}`
                    : `${ent.name}/${key.split("/").pop() ?? key}`;
                  items.push({
                    key,
                    localPath: `${destDir.replace(/\/$/, "")}/${rel}`,
                  });
                }
              } else {
                const dest = await save({ defaultPath: fileName(ent.key) });
                if (!dest) continue;
                items.push({ key: ent.key, localPath: dest });
              }
            }
            if (!items.length) return;
            await api.downloadObjects(accountId, bucket, items);
            showToast(`Download started (${items.length})`, "ok");
          } catch (e) {
            showToast(String(e), "err");
          }
        })();
      },
      onDelete: (keys: string[]) => {
        if (confirm(`Delete ${keys.length} item(s)?`)) {
          remove.mutate(keys);
        }
      },
      onPresign: async (key: string) => {
        try {
          const url = await api.presignGet(accountId, bucket, key, 3600);
          await navigator.clipboard.writeText(url);
          showToast("Presigned URL copied (1h)", "ok");
        } catch (e) {
          showToast(String(e), "err");
        }
      },
      onRename: (key: string) => {
        setRenameKey(key);
        setRenameValue(key);
        setRenameOpen(true);
      },
      onCopyTo: (ents: ObjectEntry[], source: S3CopySource) => {
        setCopyEntries(ents);
        setCopySource(source);
        setCopyMove(false);
        setCopyOpen(true);
      },
      onMoveTo: (ents: ObjectEntry[], source: S3CopySource) => {
        setCopyEntries(ents);
        setCopySource(source);
        setCopyMove(true);
        setCopyOpen(true);
      },
      onNewFolder: () => setFolderOpen(true),
      onUpload: () => upload.mutate(),
      onRefresh: () => void invalidate(),
    },
  };

  return (
    <div className="flex h-full flex-col">
      <Toolbar className="justify-end">
        <div className="flex flex-wrap items-center gap-1.5">
          <SegmentedControl<BrowserViewMode>
            value={viewMode}
            onChange={setViewMode}
            options={[
              {
                value: "single",
                title: "Single pane",
                label: (
                  <>
                    <PanelLeft size={12} /> Single
                  </>
                ),
              },
              {
                value: "split",
                title: "Split Local | S3",
                label: (
                  <>
                    <Columns2 size={12} /> Local
                  </>
                ),
              },
              {
                value: "s3s3",
                title: "Split S3 | S3",
                label: (
                  <>
                    <ArrowLeftRight size={12} /> S3↔S3
                  </>
                ),
              },
            ]}
          />
          <ToolbarButton onClick={() => setFolderOpen(true)}>
            <FolderPlus size={14} /> Folder
          </ToolbarButton>
          <ToolbarButton
            className="bg-accent text-on-accent hover:bg-accent-hover"
            onClick={() => upload.mutate()}
            disabled={upload.isPending}
          >
            <Upload size={14} /> Upload
          </ToolbarButton>
          <ToolbarButton onClick={onOpenSettings}>Settings</ToolbarButton>
        </div>
      </Toolbar>

      {selected.size > 0 && (
        <div className="flex h-9 shrink-0 flex-wrap items-center gap-1.5 border-b border-line bg-panel px-3">
          <span className="mr-1 text-[12px] text-muted">
            {selected.size} selected
          </span>
          <ToolbarButton
            disabled={!selectedFiles.length}
            onClick={() => download.mutate(selectedFiles.map((e) => e.key))}
          >
            <Download size={12} /> Download
          </ToolbarButton>
          <ToolbarButton
            disabled={!selected.size}
            onClick={() => {
              const ents =
                objects.data?.entries.filter((e) => selected.has(e.key)) ?? [];
              if (!ents.length) return;
              setCopyEntries(ents);
              setCopySource({ accountId, bucket, prefix });
              setCopyMove(false);
              setCopyOpen(true);
            }}
          >
            <Copy size={12} /> Copy to…
          </ToolbarButton>
          <ToolbarButton
            disabled={selectedFiles.length !== 1}
            onClick={() => {
              const key = selectedFiles[0]?.key;
              if (!key) return;
              setRenameKey(key);
              setRenameValue(key);
              setRenameOpen(true);
            }}
          >
            <Pencil size={12} /> Rename
          </ToolbarButton>
          <ToolbarButton
            disabled={selectedFiles.length !== 1}
            onClick={async () => {
              const key = selectedFiles[0]?.key;
              if (!key) return;
              try {
                const url = await api.presignGet(accountId, bucket, key, 3600);
                await navigator.clipboard.writeText(url);
                showToast("Presigned URL copied (1h)", "ok");
              } catch (e) {
                showToast(String(e), "err");
              }
            }}
          >
            <Link2 size={12} /> Presign
          </ToolbarButton>
          <ToolbarButton
            disabled={selectedFiles.length !== 1}
            onClick={() => {
              const key = selectedFiles[0]?.key;
              if (!key) return;
              setAclKey(key);
              setObjectAcl("private");
              setAclOpen(true);
            }}
          >
            ACL
          </ToolbarButton>
          <ToolbarButton
            className="text-danger"
            onClick={() => {
              const keys = [...selected];
              if (confirm(`Delete ${keys.length} item(s)?`)) {
                remove.mutate(keys);
              }
            }}
          >
            <Trash2 size={12} /> Delete
          </ToolbarButton>
          <ToolbarButton onClick={clearSelection}>Clear</ToolbarButton>
        </div>
      )}

      <div className="min-h-0 flex-1">
        {viewMode === "split" ? (
          <SplitTransferView
            {...listProps}
            onUploaded={() => void invalidate()}
          />
        ) : viewMode === "s3s3" ? (
          <S3SplitTransferView
            accountId={accountId}
            bucket={bucket}
            contextActions={listProps.contextActions}
            onCopied={() => void invalidate()}
          />
        ) : (
          <S3Pane {...listProps} />
        )}
      </div>

      <Modal open={folderOpen} onClose={() => setFolderOpen(false)} title="New folder">
        <Field label="Folder name">
          <Input
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            placeholder="assets"
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setFolderOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={!folderName.trim() || createFolder.isPending}
            onClick={() => createFolder.mutate()}
          >
            Create
          </Button>
        </div>
      </Modal>

      <Modal open={renameOpen} onClose={() => setRenameOpen(false)} title="Rename / move">
        <Field label="New key">
          <Input
            className="font-mono"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
          />
        </Field>
        <p className="mb-4 text-[12px] text-muted">
          S3 has no native rename — Silo copies then deletes the source.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRenameOpen(false)}>
            Cancel
          </Button>
          <Button disabled={rename.isPending} onClick={() => rename.mutate()}>
            Apply
          </Button>
        </div>
      </Modal>

      <CopyToModal
        open={copyOpen}
        onClose={() => setCopyOpen(false)}
        sourceAccountId={copySource.accountId}
        sourceBucket={copySource.bucket}
        sourcePrefix={copySource.prefix}
        entries={copyEntries}
        deleteSourceDefault={copyMove}
        onDone={async ({ destAccountId, destBucket, moved }) => {
          await qc.invalidateQueries({
            queryKey: ["objects", destAccountId, destBucket],
          });
          if (moved) {
            await qc.invalidateQueries({
              queryKey: [
                "objects",
                copySource.accountId,
                copySource.bucket,
              ],
            });
            clearSelection();
          }
          showToast(moved ? "Move started" : "Copy started", "ok");
        }}
      />

      <Modal
        open={aclOpen}
        onClose={() => setAclOpen(false)}
        title="Object ACL"
      >
        <p className="mb-3 truncate font-mono text-[12px] text-muted">{aclKey}</p>
        <Field label="Canned ACL">
          <Select
            value={objectAcl}
            onChange={(e) => setObjectAcl(e.target.value)}
          >
            <option value="private">private</option>
            <option value="public-read">public-read</option>
            <option value="public-read-write">public-read-write</option>
            <option value="authenticated-read">authenticated-read</option>
            <option value="bucket-owner-read">bucket-owner-read</option>
            <option value="bucket-owner-full-control">
              bucket-owner-full-control
            </option>
          </Select>
        </Field>
        {objectAcl.includes("public") && (
          <p className="mb-4 text-sm text-warn">
            Public ACLs expose this object. Confirm carefully.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setAclOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={async () => {
              if (!aclKey) return;
              if (
                objectAcl.includes("public") &&
                !confirm("Apply a public ACL to this object?")
              ) {
                return;
              }
              try {
                await api.putObjectAcl(accountId, bucket, aclKey, objectAcl);
                showToast("Object ACL updated", "ok");
                setAclOpen(false);
              } catch (e) {
                showToast(String(e), "err");
              }
            }}
          >
            Apply
          </Button>
        </div>
      </Modal>
    </div>
  );
}
