import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Folder, Loader2 } from "lucide-react";
import { api } from "../../lib/tauri";
import { BucketIcon } from "../../shared/BucketIcon";
import { filterVisibleBuckets } from "../../shared/buckets";
import type { ObjectEntry } from "../../shared/types";
import { Button, Field, Modal, Select, Spinner } from "../../shared/ui";

export async function collectS3KeysUnderPrefix(
  accountId: string,
  bucket: string,
  folderPrefix: string,
): Promise<string[]> {
  const keys: string[] = [];
  const queue = [folderPrefix];
  while (queue.length) {
    const prefix = queue.shift()!;
    let token: string | null = null;
    do {
      const page = await api.listObjects(accountId, bucket, prefix, token);
      for (const e of page.entries) {
        if (e.isFolder) queue.push(e.key);
        else keys.push(e.key);
      }
      token = page.nextContinuationToken;
    } while (token);
  }
  return keys;
}

/** Build dest keys preserving folder leaf names under destPrefix. */
export async function buildCopyItems(
  accountId: string,
  bucket: string,
  entries: { key: string; name: string; isFolder: boolean }[],
  destPrefix: string,
): Promise<{ sourceKey: string; destKey: string }[]> {
  const prefix =
    destPrefix.endsWith("/") || destPrefix === ""
      ? destPrefix
      : `${destPrefix}/`;
  const items: { sourceKey: string; destKey: string }[] = [];

  for (const e of entries) {
    if (e.isFolder) {
      const nested = await collectS3KeysUnderPrefix(accountId, bucket, e.key);
      for (const key of nested) {
        const rel = key.startsWith(e.key)
          ? `${e.name}/${key.slice(e.key.length)}`
          : `${e.name}/${key.split("/").pop() ?? key}`;
        items.push({ sourceKey: key, destKey: `${prefix}${rel}` });
      }
    } else {
      items.push({
        sourceKey: e.key,
        destKey: `${prefix}${e.name}`,
      });
    }
  }
  return items;
}

function folderNodeKey(prefix: string) {
  return prefix || "__root__";
}

function DestFolderNode({
  accountId,
  bucket,
  prefix,
  depth,
  selectedPrefix,
  expanded,
  onToggle,
  onSelect,
}: {
  accountId: string;
  bucket: string;
  prefix: string;
  depth: number;
  selectedPrefix: string;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (prefix: string) => void;
}) {
  const id = folderNodeKey(prefix);
  const open = expanded.has(id);
  const listing = useQuery({
    queryKey: ["objects", accountId, bucket, prefix],
    queryFn: () => api.listObjects(accountId, bucket, prefix),
    enabled: open,
    staleTime: 30_000,
  });
  const children = (listing.data?.entries ?? []).filter((e) => e.isFolder);
  const name = prefix.replace(/\/$/, "").split("/").pop() ?? prefix;
  const isSelected = selectedPrefix === prefix;

  return (
    <div>
      <div
        className={`group flex w-full items-center gap-0.5 rounded-md text-left text-[13px] ${
          isSelected ? "bg-selected text-on-accent" : "text-fg hover:bg-hover"
        }`}
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        <button
          type="button"
          className={`shrink-0 rounded p-0.5 ${
            isSelected ? "text-on-accent/80 hover:text-on-accent" : "text-muted hover:text-fg"
          }`}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(id);
          }}
        >
          {listing.isFetching && open ? (
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
          onClick={() => onSelect(prefix)}
          onDoubleClick={() => onToggle(id)}
        >
          <Folder size={13} className="shrink-0 opacity-80" />
          <span className="truncate">{name}</span>
        </button>
      </div>
      {open &&
        children.map((f) => (
          <DestFolderNode
            key={f.key}
            accountId={accountId}
            bucket={bucket}
            prefix={f.key}
            depth={depth + 1}
            selectedPrefix={selectedPrefix}
            expanded={expanded}
            onToggle={onToggle}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}

function ancestorPrefixes(prefix: string): Set<string> {
  const parents = new Set([folderNodeKey("")]);
  const segs = prefix.split("/").filter(Boolean);
  let path = "";
  for (let i = 0; i < segs.length - 1; i++) {
    path += `${segs[i]}/`;
    parents.add(folderNodeKey(path));
  }
  return parents;
}

function DestFolderTree({
  accountId,
  bucket,
  selectedPrefix,
  onSelect,
}: {
  accountId: string;
  bucket: string;
  selectedPrefix: string;
  onSelect: (prefix: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    ancestorPrefixes(selectedPrefix),
  );

  useEffect(() => {
    setExpanded(ancestorPrefixes(selectedPrefix));
    // Only reset expansion when destination location identity changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, bucket]);

  const root = useQuery({
    queryKey: ["objects", accountId, bucket, ""],
    queryFn: () => api.listObjects(accountId, bucket, ""),
    enabled: !!accountId && !!bucket,
    staleTime: 30_000,
  });

  const folders = (root.data?.entries ?? []).filter((e) => e.isFolder);
  const rootOpen = expanded.has(folderNodeKey(""));
  const rootSelected = selectedPrefix === "";

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="max-h-64 min-h-[12rem] overflow-auto rounded-md border border-line bg-sidebar py-1">
      {!bucket ? (
        <div className="px-3 py-8 text-center text-[13px] text-muted">
          Select a bucket first
        </div>
      ) : root.isLoading ? (
        <div className="flex justify-center py-10">
          <Spinner className="h-5 w-5" />
        </div>
      ) : root.isError ? (
        <div className="m-2 rounded-md border border-danger/30 bg-danger/10 px-2 py-2 text-[12px] text-danger">
          {String(root.error)}
        </div>
      ) : (
        <>
          <div
            className={`group flex w-full items-center gap-0.5 rounded-md px-2 text-left text-[13px] ${
              rootSelected
                ? "bg-selected text-on-accent"
                : "text-fg hover:bg-hover"
            }`}
          >
            <button
              type="button"
              className={`shrink-0 rounded p-0.5 ${
                rootSelected
                  ? "text-on-accent/80 hover:text-on-accent"
                  : "text-muted hover:text-fg"
              }`}
              onClick={(e) => {
                e.stopPropagation();
                toggle(folderNodeKey(""));
              }}
            >
              {root.isFetching && rootOpen ? (
                <Loader2 size={12} className="animate-spin" />
              ) : rootOpen ? (
                <ChevronDown size={12} />
              ) : (
                <ChevronRight size={12} />
              )}
            </button>
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pr-2"
              onClick={() => onSelect("")}
              onDoubleClick={() => toggle(folderNodeKey(""))}
            >
              <BucketIcon size={13} className="shrink-0" />
              <span className="truncate font-medium">{bucket}</span>
              <span
                className={`ml-1 text-[11px] ${
                  rootSelected ? "text-on-accent/70" : "text-muted"
                }`}
              >
                (root)
              </span>
            </button>
          </div>
          {rootOpen &&
            folders.map((f) => (
              <DestFolderNode
                key={f.key}
                accountId={accountId}
                bucket={bucket}
                prefix={f.key}
                depth={1}
                selectedPrefix={selectedPrefix}
                expanded={expanded}
                onToggle={toggle}
                onSelect={onSelect}
              />
            ))}
          {rootOpen && !folders.length && (
            <div className="px-3 py-2 pl-10 text-[12px] text-muted">
              No folders in this bucket
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function CopyToModal({
  open,
  onClose,
  sourceAccountId,
  sourceBucket,
  sourcePrefix,
  entries,
  deleteSourceDefault = false,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  sourceAccountId: string;
  sourceBucket: string;
  sourcePrefix: string;
  entries: ObjectEntry[];
  deleteSourceDefault?: boolean;
  onDone: (opts: {
    destAccountId: string;
    destBucket: string;
    moved: boolean;
  }) => void;
}) {
  const accounts = useQuery({
    queryKey: ["accounts"],
    queryFn: api.listAccounts,
    enabled: open,
  });

  const [destAccountId, setDestAccountId] = useState(sourceAccountId);
  const [destBucket, setDestBucket] = useState(sourceBucket);
  const [destPrefix, setDestPrefix] = useState(sourcePrefix);
  const [deleteSource, setDeleteSource] = useState(deleteSourceDefault);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDestAccountId(sourceAccountId);
    setDestBucket(sourceBucket);
    setDestPrefix("");
    setDeleteSource(deleteSourceDefault);
    setError(null);
    setBusy(false);
  }, [
    open,
    sourceAccountId,
    sourceBucket,
    sourcePrefix,
    deleteSourceDefault,
  ]);

  const buckets = useQuery({
    queryKey: ["buckets", destAccountId],
    queryFn: () => api.listBuckets(destAccountId),
    enabled: open && !!destAccountId,
  });

  const account = accounts.data?.find((a) => a.id === destAccountId);
  const visibleBuckets = useMemo(
    () => filterVisibleBuckets(account, buckets.data ?? []),
    [account, buckets.data],
  );

  useEffect(() => {
    if (!visibleBuckets.length) return;
    if (!visibleBuckets.some((b) => b.name === destBucket)) {
      setDestBucket(visibleBuckets[0].name);
      setDestPrefix("");
    }
  }, [visibleBuckets, destBucket]);

  const destPathLabel = destPrefix
    ? `${destBucket}/${destPrefix.replace(/\/$/, "")}`
    : `${destBucket}/`;

  async function confirm() {
    if (!destBucket || !entries.length) return;
    setBusy(true);
    setError(null);
    try {
      const items = await buildCopyItems(
        sourceAccountId,
        sourceBucket,
        entries.map((e) => ({
          key: e.key,
          name: e.name,
          isFolder: e.isFolder,
        })),
        destPrefix,
      );
      if (!items.length) {
        setError("Nothing to copy");
        setBusy(false);
        return;
      }
      if (
        sourceAccountId === destAccountId &&
        sourceBucket === destBucket &&
        items.every((i) => i.sourceKey === i.destKey)
      ) {
        setError("Same location — choose a different folder");
        setBusy(false);
        return;
      }
      await api.copyObjects(
        sourceAccountId,
        sourceBucket,
        destAccountId,
        destBucket,
        items,
        deleteSource,
      );
      onDone({
        destAccountId,
        destBucket,
        moved: deleteSource,
      });
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={deleteSourceDefault ? "Move to…" : "Copy to…"}
      wide
    >
      <div className="mb-3 text-sm text-muted">
        {entries.length} item{entries.length === 1 ? "" : "s"} from{" "}
        <span className="font-mono text-fg">{sourceBucket}</span>
      </div>

      <div className="mb-3 grid gap-3 sm:grid-cols-2">
        <Field label="Destination account">
          <Select
            value={destAccountId}
            onChange={(e) => {
              setDestAccountId(e.target.value);
              setDestPrefix("");
            }}
          >
            {(accounts.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Destination bucket">
          <Select
            value={destBucket}
            onChange={(e) => {
              setDestBucket(e.target.value);
              setDestPrefix("");
            }}
            disabled={!visibleBuckets.length}
          >
            {visibleBuckets.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Destination folder">
        <DestFolderTree
          accountId={destAccountId}
          bucket={destBucket}
          selectedPrefix={destPrefix}
          onSelect={setDestPrefix}
        />
        <div className="mt-1.5 truncate font-mono text-[11px] text-muted">
          Selected: <span className="text-fg">{destPathLabel}</span>
        </div>
      </Field>

      <label className="mb-4 flex items-center gap-2 text-sm text-muted">
        <input
          type="checkbox"
          className="accent-accent"
          checked={deleteSource}
          onChange={(e) => setDeleteSource(e.target.checked)}
        />
        Move (delete source after copy)
      </label>

      {error && (
        <div className="mb-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          onClick={() => void confirm()}
          disabled={busy || !destBucket || !entries.length}
        >
          {busy ? "Working…" : deleteSource ? "Move" : "Copy"}
        </Button>
      </div>
    </Modal>
  );
}
