import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FolderOpen, Plus, Settings, Trash2 } from "lucide-react";
import { api, formatDate } from "../../lib/tauri";
import { filterVisibleBuckets } from "../../shared/buckets";
import { useUiStore } from "../../shared/store";
import { Button, Field, Input, Modal, Spinner } from "../../shared/ui";

export function BucketsView({
  accountId,
  onBack,
  onOpenBucket,
  onOpenSettings,
}: {
  accountId: string;
  onBack: () => void;
  onOpenBucket: (bucket: string) => void;
  onOpenSettings: (bucket: string) => void;
}) {
  const qc = useQueryClient();
  const showToast = useUiStore((s) => s.showToast);
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: api.listAccounts });
  const account = accounts.data?.find((a) => a.id === accountId);

  const buckets = useQuery({
    queryKey: ["buckets", accountId],
    queryFn: () => api.listBuckets(accountId),
  });

  const visible = useMemo(
    () => filterVisibleBuckets(account, buckets.data ?? []),
    [account, buckets.data],
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [region, setRegion] = useState(account?.region ?? "us-east-1");

  const create = useMutation({
    mutationFn: async () => {
      const bucketName = name.trim();
      await api.createBucket(accountId, bucketName, region.trim());
      if (
        account &&
        account.bucketFilterMode === "selected" &&
        !account.visibleBuckets.includes(bucketName)
      ) {
        await api.upsertAccount({
          id: account.id,
          name: account.name,
          provider: account.provider,
          region: account.region,
          endpointUrl: account.endpointUrl,
          forcePathStyle: account.forcePathStyle,
          accessKeyId: account.accessKeyId,
          bucketFilterMode: "selected",
          visibleBuckets: [...account.visibleBuckets, bucketName],
        });
      }
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["buckets", accountId] });
      await qc.invalidateQueries({ queryKey: ["accounts"] });
      setCreateOpen(false);
      setName("");
      showToast("Bucket created", "ok");
    },
    onError: (e: Error) => showToast(String(e), "err"),
  });

  const remove = useMutation({
    mutationFn: (bucket: string) => api.deleteBucket(accountId, bucket),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["buckets", accountId] });
      showToast("Bucket deleted", "ok");
    },
    onError: (e: Error) => showToast(String(e), "err"),
  });

  return (
    <div className="flex h-full flex-col anim-fade-in">
      <header className="flex items-center justify-between border-b border-ink-700 px-6 py-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={onBack} className="px-2">
            <ArrowLeft size={16} />
          </Button>
          <div>
            <h1 className="text-xl font-semibold">
              {account?.name ?? "Buckets"}
            </h1>
            <p className="text-sm text-mist-400">
              {visible.length} bucket{visible.length === 1 ? "" : "s"}
              {account?.bucketFilterMode === "selected" &&
                buckets.data &&
                buckets.data.length !== visible.length && (
                  <span>
                    {" "}
                    · {buckets.data.length} found
                  </span>
                )}
            </p>
          </div>
        </div>
        <Button
          onClick={() => {
            setRegion(account?.region ?? "us-east-1");
            setCreateOpen(true);
          }}
        >
          <Plus size={16} /> Create bucket
        </Button>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {buckets.isLoading && (
          <div className="flex justify-center py-20">
            <Spinner className="h-6 w-6" />
          </div>
        )}
        {buckets.isError && (
          <div className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-danger">
            {String(buckets.error)}
          </div>
        )}
        {buckets.data && visible.length === 0 && (
          <div className="py-20 text-center text-mist-400">
            {account?.bucketFilterMode === "selected"
              ? "No selected buckets. Edit the account to choose which buckets to display."
              : "No buckets yet. Create one to start uploading objects."}
          </div>
        )}
        <div className="stagger divide-y divide-ink-700 overflow-hidden rounded-xl border border-ink-600">
          {visible.map((b) => (
            <div
              key={b.name}
              className="flex items-center gap-3 bg-ink-800/30 px-4 py-3 hover:bg-ink-800/60"
            >
              <button
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
                onClick={() => onOpenBucket(b.name)}
              >
                <FolderOpen className="shrink-0 text-accent" size={18} />
                <div className="min-w-0">
                  <div className="truncate font-medium text-mist-100">
                    {b.name}
                  </div>
                  <div className="text-xs text-mist-400">
                    Created {formatDate(b.creationDate)}
                  </div>
                </div>
              </button>
              <Button
                variant="ghost"
                className="px-2"
                title="Bucket settings"
                onClick={() => onOpenSettings(b.name)}
              >
                <Settings size={16} />
              </Button>
              <Button
                variant="ghost"
                className="px-2 text-danger"
                onClick={() => {
                  if (
                    confirm(
                      `Delete empty bucket “${b.name}”? This fails if the bucket is not empty.`,
                    )
                  ) {
                    remove.mutate(b.name);
                  }
                }}
              >
                <Trash2 size={16} />
              </Button>
            </div>
          ))}
        </div>
      </div>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create bucket"
      >
        <Field label="Bucket name">
          <Input
            className="font-mono"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-bucket"
          />
        </Field>
        <Field label="Region">
          <Input value={region} onChange={(e) => setRegion(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setCreateOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim() || create.isPending}
            onClick={() => create.mutate()}
          >
            Create
          </Button>
        </div>
      </Modal>
    </div>
  );
}
