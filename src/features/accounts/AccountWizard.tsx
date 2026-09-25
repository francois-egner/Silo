import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { api } from "../../lib/tauri";
import type {
  BucketFilterMode,
  Provider,
  UpsertAccountInput,
} from "../../shared/types";
import { PROVIDER_PRESETS } from "../../shared/types";
import { useUiStore } from "../../shared/store";
import { Button, Field, Input, Modal } from "../../shared/ui";

export function AccountWizard({
  open,
  onClose,
  editId,
}: {
  open: boolean;
  onClose: () => void;
  editId?: string | null;
}) {
  const qc = useQueryClient();
  const showToast = useUiStore((s) => s.showToast);
  const setActive = useUiStore((s) => s.setActiveAccountId);
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: api.listAccounts });
  const existing = useMemo(
    () => accounts.data?.find((a) => a.id === editId),
    [accounts.data, editId],
  );

  const [provider, setProvider] = useState<Provider>("aws");
  const [name, setName] = useState("");
  const [region, setRegion] = useState("us-east-1");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [forcePathStyle, setForcePathStyle] = useState(false);
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secret, setSecret] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [testing, setTesting] = useState(false);
  const [testOk, setTestOk] = useState<string | null>(null);
  const [bucketFilterMode, setBucketFilterMode] =
    useState<BucketFilterMode>("all");
  const [visibleBuckets, setVisibleBuckets] = useState<string[]>([]);
  const [discoveredBuckets, setDiscoveredBuckets] = useState<string[]>([]);
  const [loadingBuckets, setLoadingBuckets] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (existing) {
      setProvider(existing.provider);
      setName(existing.name);
      setRegion(existing.region);
      setEndpointUrl(existing.endpointUrl ?? "");
      setForcePathStyle(existing.forcePathStyle);
      setAccessKeyId(existing.accessKeyId);
      setSecret("");
      setSessionToken("");
      setBucketFilterMode(existing.bucketFilterMode ?? "all");
      setVisibleBuckets(existing.visibleBuckets ?? []);
      setTestOk(null);
      setDiscoveredBuckets([]);
    } else {
      const p = PROVIDER_PRESETS.aws;
      setProvider("aws");
      setName("");
      setRegion(p.region);
      setEndpointUrl(p.endpointUrl);
      setForcePathStyle(p.forcePathStyle);
      setAccessKeyId("");
      setSecret("");
      setSessionToken("");
      setBucketFilterMode("all");
      setVisibleBuckets([]);
      setDiscoveredBuckets([]);
      setTestOk(null);
    }
  }, [open, existing]);

  useEffect(() => {
    if (!open || !editId) return;
    let cancelled = false;
    setLoadingBuckets(true);
    api
      .listBuckets(editId)
      .then((list) => {
        if (cancelled) return;
        setDiscoveredBuckets(list.map((b) => b.name).sort());
      })
      .catch(() => {
        if (!cancelled) setDiscoveredBuckets([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingBuckets(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, editId]);

  function applyPreset(p: Provider) {
    const preset = PROVIDER_PRESETS[p];
    setProvider(p);
    setRegion(preset.region);
    setEndpointUrl(preset.endpointUrl);
    setForcePathStyle(preset.forcePathStyle);
    if (!name) setName(preset.label);
  }

  function buildInput(): UpsertAccountInput {
    return {
      id: editId ?? null,
      name: name.trim() || PROVIDER_PRESETS[provider].label,
      provider,
      region: region.trim(),
      endpointUrl: endpointUrl.trim() || null,
      forcePathStyle,
      accessKeyId: accessKeyId.trim(),
      secretAccessKey: secret || null,
      sessionToken: sessionToken || null,
      bucketFilterMode,
      visibleBuckets:
        bucketFilterMode === "selected" ? [...visibleBuckets].sort() : [],
    };
  }

  function toggleBucket(name: string) {
    setVisibleBuckets((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  }

  const save = useMutation({
    mutationFn: () => api.upsertAccount(buildInput()),
    onSuccess: async (account) => {
      await qc.invalidateQueries({ queryKey: ["accounts"] });
      await api.setActiveAccount(account.id);
      setActive(account.id);
      showToast("Account saved", "ok");
      onClose();
    },
    onError: (e: Error) => showToast(String(e), "err"),
  });

  async function onTest() {
    setTesting(true);
    setTestOk(null);
    try {
      const names =
        editId && !secret
          ? await api.testAccount({ id: editId })
          : await api.testAccount({ input: buildInput() });
      const sorted = [...names].sort();
      setDiscoveredBuckets(sorted);
      setTestOk(
        `Connected — ${sorted.length} bucket${sorted.length === 1 ? "" : "s"} found`,
      );
      showToast("Connection OK", "ok");
    } catch (e) {
      showToast(String(e), "err");
    } finally {
      setTesting(false);
    }
  }

  const bucketList =
    discoveredBuckets.length > 0
      ? discoveredBuckets
      : [...visibleBuckets].sort();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editId ? "Edit account" : "Add account"}
      wide
    >
      <div className="mb-5 flex flex-wrap gap-2">
        {(Object.keys(PROVIDER_PRESETS) as Provider[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => applyPreset(p)}
            className={`rounded-md border px-2.5 py-1 text-[12px] transition ${
              provider === p
                ? "border-accent bg-selected-muted text-accent"
                : "border-line text-muted hover:bg-hover"
            }`}
          >
            {PROVIDER_PRESETS[p].label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Display name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Production"
          />
        </Field>
        <Field label="Region">
          <Input value={region} onChange={(e) => setRegion(e.target.value)} />
        </Field>
        <Field label="Access key ID">
          <Input
            className="font-mono"
            value={accessKeyId}
            onChange={(e) => setAccessKeyId(e.target.value)}
            autoComplete="off"
          />
        </Field>
        <Field
          label={
            editId ? "Secret access key (leave blank to keep)" : "Secret access key"
          }
        >
          <Input
            className="font-mono"
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        <Field label="Endpoint URL">
          <Input
            className="font-mono"
            value={endpointUrl}
            onChange={(e) => setEndpointUrl(e.target.value)}
            onBlur={() => {
              const v = endpointUrl.trim();
              if (!v) return;
              if (!/^https?:\/\//i.test(v)) {
                const local =
                  /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(v);
                setEndpointUrl(`${local ? "http" : "https"}://${v}`);
              }
            }}
            placeholder="https://s3.eu-central-2.wasabisys.com"
          />
        </Field>
        <Field label="Session token (optional)">
          <Input
            className="font-mono"
            value={sessionToken}
            onChange={(e) => setSessionToken(e.target.value)}
          />
        </Field>
      </div>

      <label className="mb-4 flex items-center gap-2 text-[13px] text-muted">
        <input
          type="checkbox"
          checked={forcePathStyle}
          onChange={(e) => setForcePathStyle(e.target.checked)}
          className="accent-accent"
        />
        Force path-style addressing (MinIO / some compatible stores)
      </label>

      <div className="mb-4 rounded-md border border-line bg-app p-3">
        <div className="mb-2 text-[12px] font-medium text-muted">
          Buckets to display
        </div>
        <div className="mb-3 flex flex-col gap-2">
          <label className="flex cursor-pointer items-start gap-2 text-[13px] text-fg">
            <input
              type="radio"
              name="bucket-filter"
              className="mt-0.5 accent-accent"
              checked={bucketFilterMode === "all"}
              onChange={() => setBucketFilterMode("all")}
            />
            <span>
              <span className="font-medium text-fg">All buckets</span>
              <span className="mt-0.5 block text-[11px] text-muted">
                Show every bucket this account can list
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-[13px] text-fg">
            <input
              type="radio"
              name="bucket-filter"
              className="mt-0.5 accent-accent"
              checked={bucketFilterMode === "selected"}
              onChange={() => setBucketFilterMode("selected")}
            />
            <span>
              <span className="font-medium text-fg">Selected buckets</span>
              <span className="mt-0.5 block text-[11px] text-muted">
                Only show the buckets you pick below
              </span>
            </span>
          </label>
        </div>

        {bucketFilterMode === "selected" && (
          <div className="space-y-2">
            {loadingBuckets && (
              <div className="flex items-center gap-2 text-[11px] text-muted">
                <Loader2 size={12} className="animate-spin" /> Loading buckets…
              </div>
            )}
            {!loadingBuckets && bucketList.length === 0 && (
              <p className="text-[11px] text-muted">
                Test the connection to discover buckets, then select which ones
                to show.
              </p>
            )}
            {bucketList.length > 0 && (
              <div className="max-h-40 space-y-0.5 overflow-y-auto rounded-md border border-line bg-panel p-1.5">
                {bucketList.map((b) => (
                  <label
                    key={b}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[13px] text-fg hover:bg-hover"
                  >
                    <input
                      type="checkbox"
                      className="accent-accent"
                      checked={visibleBuckets.includes(b)}
                      onChange={() => toggleBucket(b)}
                    />
                    <span className="truncate font-mono text-[12px]">{b}</span>
                  </label>
                ))}
              </div>
            )}
            {bucketList.length > 0 && (
              <div className="flex gap-2">
                <button
                  type="button"
                  className="text-[11px] text-accent hover:underline"
                  onClick={() => setVisibleBuckets([...bucketList])}
                >
                  Select all
                </button>
                <button
                  type="button"
                  className="text-[11px] text-muted hover:underline"
                  onClick={() => setVisibleBuckets([])}
                >
                  Clear
                </button>
              </div>
            )}
            {bucketFilterMode === "selected" &&
              visibleBuckets.length === 0 &&
              bucketList.length > 0 && (
                <p className="text-[11px] text-warn">
                  Pick at least one bucket, or switch back to All buckets.
                </p>
              )}
          </div>
        )}
      </div>

      {testOk && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-ok/30 bg-ok/10 px-3 py-2 text-[13px] text-ok">
          <Check size={14} /> {testOk}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="subtle"
          onClick={onTest}
          disabled={testing || !accessKeyId}
        >
          {testing ? <Loader2 className="animate-spin" size={16} /> : null}
          Test connection
        </Button>
        <Button
          onClick={() => save.mutate()}
          disabled={
            save.isPending ||
            !accessKeyId ||
            (!editId && !secret) ||
            (bucketFilterMode === "selected" && visibleBuckets.length === 0)
          }
        >
          {save.isPending ? <Loader2 className="animate-spin" size={16} /> : null}
          Save
        </Button>
      </div>
    </Modal>
  );
}
