import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/tauri";
import { filterVisibleBuckets } from "../../shared/buckets";
import type { ObjectEntry } from "../../shared/types";
import { Button, Field, Input, Modal, Select } from "../../shared/ui";

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
  const prefix = destPrefix.endsWith("/") || destPrefix === ""
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
    setDestPrefix(sourcePrefix);
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
    }
  }, [visibleBuckets, destBucket]);

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
        destPrefix.trim(),
      );
      if (!items.length) {
        setError("Nothing to copy");
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
    >
      <div className="mb-3 text-sm text-mist-400">
        {entries.length} item{entries.length === 1 ? "" : "s"} from{" "}
        <span className="font-mono text-mist-200">{sourceBucket}</span>
      </div>

      <Field label="Destination account">
        <Select
          value={destAccountId}
          onChange={(e) => setDestAccountId(e.target.value)}
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
          onChange={(e) => setDestBucket(e.target.value)}
          disabled={!visibleBuckets.length}
        >
          {visibleBuckets.map((b) => (
            <option key={b.name} value={b.name}>
              {b.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Destination prefix">
        <Input
          className="font-mono"
          value={destPrefix}
          onChange={(e) => setDestPrefix(e.target.value)}
          placeholder="folder/ or leave empty for bucket root"
        />
      </Field>

      <label className="mb-4 flex items-center gap-2 text-sm text-mist-300">
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
