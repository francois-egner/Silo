import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Settings, Trash2 } from "lucide-react";
import { api, formatDate } from "../../lib/tauri";
import { BucketIcon } from "../../shared/BucketIcon";
import { filterVisibleBuckets } from "../../shared/buckets";
import { useUiStore } from "../../shared/store";
import {
  Button,
  Field,
  Input,
  Modal,
  Spinner,
  Toolbar,
  ToolbarButton,
} from "../../shared/ui";

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
    <div className="flex h-full flex-col">
      <Toolbar className="justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <ToolbarButton onClick={onBack} title="Back">
            <ArrowLeft size={14} />
          </ToolbarButton>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold">
              {account?.name ?? "Buckets"}
            </div>
            <div className="text-[11px] text-muted">
              {visible.length} bucket{visible.length === 1 ? "" : "s"}
              {account?.bucketFilterMode === "selected" &&
                buckets.data &&
                buckets.data.length !== visible.length && (
                  <span> · {buckets.data.length} found</span>
                )}
            </div>
          </div>
        </div>
        <ToolbarButton
          className="bg-accent text-on-accent hover:bg-accent-hover"
          onClick={() => {
            setRegion(account?.region ?? "us-east-1");
            setCreateOpen(true);
          }}
        >
          <Plus size={14} /> Create bucket
        </ToolbarButton>
      </Toolbar>

      <div className="flex-1 overflow-auto bg-panel">
        {buckets.isLoading && (
          <div className="flex justify-center py-16">
            <Spinner className="h-6 w-6" />
          </div>
        )}
        {buckets.isError && (
          <div className="m-3 rounded-md border border-danger/30 bg-danger/10 p-3 text-[13px] text-danger">
            {String(buckets.error)}
          </div>
        )}
        {buckets.data && visible.length === 0 && (
          <div className="py-16 text-center text-[13px] text-muted">
            {account?.bucketFilterMode === "selected"
              ? "No selected buckets. Edit the account to choose which buckets to display."
              : "No buckets yet. Create one to start uploading objects."}
          </div>
        )}
        {visible.map((b) => (
          <div
            key={b.name}
            className="flex items-center gap-2 border-b border-line px-3 py-1.5 hover:bg-hover"
          >
            <button
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
              onClick={() => onOpenBucket(b.name)}
            >
              <BucketIcon className="shrink-0 text-muted" size={15} />
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium text-fg">
                  {b.name}
                </div>
                <div className="text-[11px] text-muted">
                  Created {formatDate(b.creationDate)}
                </div>
              </div>
            </button>
            <ToolbarButton
              title="Bucket settings"
              onClick={() => onOpenSettings(b.name)}
            >
              <Settings size={14} />
            </ToolbarButton>
            <ToolbarButton
              className="text-danger"
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
              <Trash2 size={14} />
            </ToolbarButton>
          </div>
        ))}
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
