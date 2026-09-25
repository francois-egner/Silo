import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Copy, FolderOpen } from "lucide-react";
import { api } from "../../lib/tauri";
import type { BucketSettingsTab } from "../../shared/types";
import { useUiStore } from "../../shared/store";
import {
  Button,
  Field,
  Select,
  Spinner,
  TextArea,
  Toolbar,
  ToolbarButton,
} from "../../shared/ui";

const CANNED = [
  "private",
  "public-read",
  "public-read-write",
  "authenticated-read",
];

const TABS: { id: BucketSettingsTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "access", label: "Access" },
  { id: "policy", label: "Policy" },
  { id: "versioning", label: "Versioning" },
  { id: "cors", label: "CORS" },
  { id: "lifecycle", label: "Lifecycle" },
  { id: "encryption", label: "Encryption" },
];

const CORS_PLACEHOLDER = `[
  {
    "allowedOrigins": ["*"],
    "allowedMethods": ["GET", "HEAD"],
    "allowedHeaders": ["*"],
    "exposeHeaders": ["ETag"],
    "maxAgeSeconds": 3600
  }
]`;

const LIFECYCLE_PLACEHOLDER = `[
  {
    "id": "expire-old",
    "status": "Enabled",
    "filter": { "prefix": "" },
    "expiration": { "days": 90 }
  }
]`;

function deniedResult(e: unknown) {
  if (/AccessDenied/i.test(String(e))) return { denied: true as const };
  throw e;
}

export function BucketSettings({
  accountId,
  bucket,
  onBack,
  onOpenBucket,
  onDeleted,
  initialTab = "overview",
}: {
  accountId: string;
  bucket: string;
  onBack: () => void;
  onOpenBucket?: () => void;
  onDeleted?: () => void;
  initialTab?: BucketSettingsTab;
}) {
  const showToast = useUiStore((s) => s.showToast);
  const qc = useQueryClient();
  const [acl, setAcl] = useState("private");
  const [policyText, setPolicyText] = useState("");
  const [corsText, setCorsText] = useState("");
  const [lifecycleText, setLifecycleText] = useState("");
  const [tab, setTab] = useState<BucketSettingsTab>(initialTab);
  const [versionStatus, setVersionStatus] = useState("Enabled");
  const [encMode, setEncMode] = useState<"sseS3" | "none">("none");

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab, bucket]);

  const aclQuery = useQuery({
    queryKey: ["bucket-acl", accountId, bucket],
    queryFn: async () => {
      try {
        return await api.getBucketAcl(accountId, bucket);
      } catch (e) {
        return deniedResult(e);
      }
    },
    retry: false,
  });

  const policyQuery = useQuery({
    queryKey: ["bucket-policy", accountId, bucket],
    queryFn: async () => {
      try {
        return await api.getBucketPolicy(accountId, bucket);
      } catch (e) {
        return deniedResult(e);
      }
    },
    retry: false,
  });

  const versionQuery = useQuery({
    queryKey: ["bucket-versioning", accountId, bucket],
    queryFn: async () => {
      try {
        return await api.getBucketVersioning(accountId, bucket);
      } catch (e) {
        return deniedResult(e);
      }
    },
    retry: false,
  });

  const corsQuery = useQuery({
    queryKey: ["bucket-cors", accountId, bucket],
    queryFn: async () => {
      try {
        return await api.getBucketCors(accountId, bucket);
      } catch (e) {
        return deniedResult(e);
      }
    },
    retry: false,
  });

  const lifecycleQuery = useQuery({
    queryKey: ["bucket-lifecycle", accountId, bucket],
    queryFn: async () => {
      try {
        return await api.getBucketLifecycle(accountId, bucket);
      } catch (e) {
        return deniedResult(e);
      }
    },
    retry: false,
  });

  const encQuery = useQuery({
    queryKey: ["bucket-encryption", accountId, bucket],
    queryFn: async () => {
      try {
        return await api.getBucketEncryption(accountId, bucket);
      } catch (e) {
        return deniedResult(e);
      }
    },
    retry: false,
  });

  const aclDenied =
    !!aclQuery.data && "denied" in aclQuery.data && aclQuery.data.denied;
  const policyDenied =
    !!policyQuery.data &&
    typeof policyQuery.data === "object" &&
    policyQuery.data !== null &&
    "denied" in policyQuery.data;
  const versionDenied =
    !!versionQuery.data &&
    "denied" in versionQuery.data &&
    versionQuery.data.denied;
  const corsDenied =
    !!corsQuery.data &&
    typeof corsQuery.data === "object" &&
    corsQuery.data !== null &&
    "denied" in corsQuery.data;
  const lifecycleDenied =
    !!lifecycleQuery.data &&
    typeof lifecycleQuery.data === "object" &&
    lifecycleQuery.data !== null &&
    "denied" in lifecycleQuery.data;
  const encDenied =
    !!encQuery.data && "denied" in encQuery.data && encQuery.data.denied;

  useEffect(() => {
    if (policyQuery.data && typeof policyQuery.data === "string") {
      try {
        setPolicyText(JSON.stringify(JSON.parse(policyQuery.data), null, 2));
      } catch {
        setPolicyText(policyQuery.data);
      }
    } else if (policyQuery.data === null) {
      setPolicyText("");
    }
  }, [policyQuery.data]);

  useEffect(() => {
    if (
      versionQuery.data &&
      typeof versionQuery.data === "object" &&
      "status" in versionQuery.data
    ) {
      const s = versionQuery.data.status;
      setVersionStatus(s === "Suspended" ? "Suspended" : "Enabled");
    }
  }, [versionQuery.data]);

  useEffect(() => {
    if (corsQuery.data && typeof corsQuery.data === "string") {
      setCorsText(corsQuery.data);
    } else if (corsQuery.data === null) {
      setCorsText("");
    }
  }, [corsQuery.data]);

  useEffect(() => {
    if (lifecycleQuery.data && typeof lifecycleQuery.data === "string") {
      setLifecycleText(lifecycleQuery.data);
    } else if (lifecycleQuery.data === null) {
      setLifecycleText("");
    }
  }, [lifecycleQuery.data]);

  useEffect(() => {
    if (
      encQuery.data &&
      typeof encQuery.data === "object" &&
      "algorithm" in encQuery.data
    ) {
      setEncMode(encQuery.data.algorithm ? "sseS3" : "none");
    }
  }, [encQuery.data]);

  useEffect(() => {
    return () => {
      const toast = useUiStore.getState().toast;
      if (toast && /AccessDenied/i.test(toast.message)) {
        useUiStore.getState().clearToast();
      }
      qc.removeQueries({ queryKey: ["bucket-acl", accountId, bucket] });
      qc.removeQueries({ queryKey: ["bucket-policy", accountId, bucket] });
      qc.removeQueries({ queryKey: ["bucket-versioning", accountId, bucket] });
      qc.removeQueries({ queryKey: ["bucket-cors", accountId, bucket] });
      qc.removeQueries({ queryKey: ["bucket-lifecycle", accountId, bucket] });
      qc.removeQueries({ queryKey: ["bucket-encryption", accountId, bucket] });
    };
  }, [accountId, bucket, qc]);

  const putAcl = useMutation({
    mutationFn: () => api.putBucketAcl(accountId, bucket, acl),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["bucket-acl", accountId, bucket] });
      showToast("Bucket ACL updated", "ok");
    },
    onError: (e: Error) => showToast(String(e), "err"),
  });

  const putPolicy = useMutation({
    mutationFn: () => {
      JSON.parse(policyText);
      return api.putBucketPolicy(accountId, bucket, policyText);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({
        queryKey: ["bucket-policy", accountId, bucket],
      });
      showToast("Bucket policy saved", "ok");
    },
    onError: (e: Error) => showToast(String(e), "err"),
  });

  const delPolicy = useMutation({
    mutationFn: () => api.deleteBucketPolicy(accountId, bucket),
    onSuccess: async () => {
      setPolicyText("");
      await qc.invalidateQueries({
        queryKey: ["bucket-policy", accountId, bucket],
      });
      showToast("Bucket policy deleted", "ok");
    },
    onError: (e: Error) => showToast(String(e), "err"),
  });

  const putVersioning = useMutation({
    mutationFn: () =>
      api.putBucketVersioning(accountId, bucket, versionStatus),
    onSuccess: async () => {
      await qc.invalidateQueries({
        queryKey: ["bucket-versioning", accountId, bucket],
      });
      showToast("Versioning updated", "ok");
    },
    onError: (e: Error) => showToast(String(e), "err"),
  });

  const putCors = useMutation({
    mutationFn: () => {
      JSON.parse(corsText);
      return api.putBucketCors(accountId, bucket, corsText);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({
        queryKey: ["bucket-cors", accountId, bucket],
      });
      showToast("CORS saved", "ok");
    },
    onError: (e: Error) => showToast(String(e), "err"),
  });

  const delCors = useMutation({
    mutationFn: () => api.deleteBucketCors(accountId, bucket),
    onSuccess: async () => {
      setCorsText("");
      await qc.invalidateQueries({
        queryKey: ["bucket-cors", accountId, bucket],
      });
      showToast("CORS deleted", "ok");
    },
    onError: (e: Error) => showToast(String(e), "err"),
  });

  const putLifecycle = useMutation({
    mutationFn: () => {
      JSON.parse(lifecycleText);
      return api.putBucketLifecycle(accountId, bucket, lifecycleText);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({
        queryKey: ["bucket-lifecycle", accountId, bucket],
      });
      showToast("Lifecycle saved", "ok");
    },
    onError: (e: Error) => showToast(String(e), "err"),
  });

  const delLifecycle = useMutation({
    mutationFn: () => api.deleteBucketLifecycle(accountId, bucket),
    onSuccess: async () => {
      setLifecycleText("");
      await qc.invalidateQueries({
        queryKey: ["bucket-lifecycle", accountId, bucket],
      });
      showToast("Lifecycle deleted", "ok");
    },
    onError: (e: Error) => showToast(String(e), "err"),
  });

  const putEnc = useMutation({
    mutationFn: () => api.putBucketEncryption(accountId, bucket, encMode),
    onSuccess: async () => {
      await qc.invalidateQueries({
        queryKey: ["bucket-encryption", accountId, bucket],
      });
      showToast("Encryption updated", "ok");
    },
    onError: (e: Error) => showToast(String(e), "err"),
  });

  const emptyBucket = useMutation({
    mutationFn: () => api.emptyBucket(accountId, bucket),
    onSuccess: async (n) => {
      await qc.invalidateQueries({
        queryKey: ["objects", accountId, bucket],
      });
      showToast(`Deleted ${n} object(s)`, "ok");
    },
    onError: (e: Error) => showToast(String(e), "err"),
  });

  const deleteBucket = useMutation({
    mutationFn: () => api.deleteBucket(accountId, bucket),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["buckets", accountId] });
      showToast("Bucket deleted", "ok");
      onDeleted?.();
    },
    onError: (e: Error) => showToast(String(e), "err"),
  });

  const isPublicish =
    acl.includes("public") || /"Principal"\s*:\s*"\*"/i.test(policyText);

  return (
    <div className="flex h-full flex-col">
      <Toolbar>
        <ToolbarButton onClick={onBack} title="Back">
          <ArrowLeft size={14} />
        </ToolbarButton>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold">{bucket}</div>
          <div className="text-[11px] text-muted">Bucket configuration</div>
        </div>
      </Toolbar>

      <div className="flex min-h-0 flex-1">
        <nav className="flex w-40 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line bg-sidebar p-1.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`rounded-md px-2 py-1.5 text-left text-[12px] font-medium ${
                tab === t.id
                  ? "bg-selected text-on-accent"
                  : "text-fg hover:bg-hover"
              }`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-auto bg-panel p-4">
        {isPublicish && (tab === "access" || tab === "policy") && (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[13px] text-warn">
            <AlertTriangle className="mt-0.5 shrink-0" size={16} />
            <div>
              This configuration may allow public access. Double-check before
              applying changes to production data.
            </div>
          </div>
        )}

        {tab === "overview" && (
          <div className="max-w-xl space-y-5">
            <div>
              <h3 className="mb-1 text-[12px] font-medium text-muted">Name</h3>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded-md border border-line bg-input px-2.5 py-1.5 font-mono text-[13px]">
                  {bucket}
                </code>
                <Button
                  variant="subtle"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(bucket);
                      showToast("Copied", "ok");
                    } catch (e) {
                      showToast(String(e), "err");
                    }
                  }}
                >
                  <Copy size={14} /> Copy
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {onOpenBucket && (
                <Button variant="subtle" onClick={onOpenBucket}>
                  <FolderOpen size={16} /> Open bucket
                </Button>
              )}
              <Button
                variant="danger"
                disabled={emptyBucket.isPending}
                onClick={() => {
                  if (
                    confirm(
                      `Empty “${bucket}”? This permanently deletes all objects.`,
                    )
                  ) {
                    emptyBucket.mutate();
                  }
                }}
              >
                Empty bucket
              </Button>
              <Button
                variant="danger"
                disabled={deleteBucket.isPending}
                onClick={() => {
                  if (
                    confirm(
                      `Delete bucket “${bucket}”? The bucket must be empty.`,
                    )
                  ) {
                    deleteBucket.mutate();
                  }
                }}
              >
                Delete bucket
              </Button>
            </div>
          </div>
        )}

        {tab === "access" && (
          <div className="max-w-xl">
            <Field label="Canned ACL">
              <Select value={acl} onChange={(e) => setAcl(e.target.value)}>
                {CANNED.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <Button
              disabled={putAcl.isPending}
              onClick={() => {
                if (
                  acl.includes("public") &&
                  !confirm("Apply a public-readable ACL to this bucket?")
                ) {
                  return;
                }
                putAcl.mutate();
              }}
            >
              Apply ACL
            </Button>
            <div className="mt-8">
              <h3 className="mb-2 text-sm font-medium text-muted">
                Current grants
              </h3>
              {aclQuery.isLoading && <Spinner />}
              {aclDenied && (
                <p className="text-sm text-muted">
                  This store denied ACL reads (common on Wasabi). Object browse
                  can still work — ACLs may be unsupported for this account.
                </p>
              )}
              {aclQuery.data && !aclDenied && "grants" in aclQuery.data && (
                <ul className="space-y-2 text-sm">
                  {aclQuery.data.grants.map((g, i) => (
                    <li
                      key={i}
                      className="rounded-lg border border-line bg-panel px-3 py-2"
                    >
                      <div className="font-mono text-xs text-muted">
                        {g.grantee}
                      </div>
                      <div className="text-fg">{g.permission}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {tab === "policy" && (
          <div className="max-w-3xl">
            {policyQuery.isLoading && <Spinner />}
            {policyDenied && (
              <p className="mb-4 text-sm text-muted">
                Bucket policy reads were denied. Many S3-compatible stores
                (including Wasabi) restrict or omit this API.
              </p>
            )}
            <Field label="Policy JSON">
              <TextArea
                rows={16}
                value={policyText}
                onChange={(e) => setPolicyText(e.target.value)}
                placeholder='{\n  "Version": "2012-10-17",\n  "Statement": []\n}'
              />
            </Field>
            <div className="flex gap-2">
              <Button
                variant="subtle"
                onClick={() => {
                  try {
                    setPolicyText(
                      JSON.stringify(JSON.parse(policyText), null, 2),
                    );
                  } catch {
                    showToast("Invalid JSON", "err");
                  }
                }}
              >
                Pretty print
              </Button>
              <Button
                disabled={!policyText.trim() || putPolicy.isPending}
                onClick={() => {
                  if (
                    /"Principal"\s*:\s*"\*"/i.test(policyText) &&
                    !confirm("This policy appears open to the world. Continue?")
                  ) {
                    return;
                  }
                  putPolicy.mutate();
                }}
              >
                Save policy
              </Button>
              <Button
                variant="danger"
                disabled={delPolicy.isPending}
                onClick={() => {
                  if (confirm("Delete the bucket policy?")) delPolicy.mutate();
                }}
              >
                Delete policy
              </Button>
            </div>
          </div>
        )}

        {tab === "versioning" && (
          <div className="max-w-xl">
            {versionQuery.isLoading && <Spinner />}
            {versionDenied && (
              <p className="mb-4 text-sm text-muted">
                Versioning API denied by this store.
              </p>
            )}
            {!versionDenied &&
              versionQuery.data &&
              "status" in versionQuery.data && (
                <p className="mb-4 text-sm text-muted">
                  Current status:{" "}
                  <span className="font-medium text-fg">
                    {versionQuery.data.status}
                  </span>
                </p>
              )}
            <Field label="Status">
              <Select
                value={versionStatus}
                onChange={(e) => setVersionStatus(e.target.value)}
              >
                <option value="Enabled">Enabled</option>
                <option value="Suspended">Suspended</option>
              </Select>
            </Field>
            <Button
              disabled={putVersioning.isPending || versionDenied}
              onClick={() => putVersioning.mutate()}
            >
              Apply versioning
            </Button>
          </div>
        )}

        {tab === "cors" && (
          <div className="max-w-3xl">
            {corsQuery.isLoading && <Spinner />}
            {corsDenied && (
              <p className="mb-4 text-sm text-muted">
                CORS API denied by this store.
              </p>
            )}
            <Field label="CORS rules (JSON array)">
              <TextArea
                rows={14}
                value={corsText}
                onChange={(e) => setCorsText(e.target.value)}
                placeholder={CORS_PLACEHOLDER}
              />
            </Field>
            <div className="flex gap-2">
              <Button
                variant="subtle"
                onClick={() => {
                  try {
                    setCorsText(
                      JSON.stringify(JSON.parse(corsText || "[]"), null, 2),
                    );
                  } catch {
                    showToast("Invalid JSON", "err");
                  }
                }}
              >
                Pretty print
              </Button>
              <Button
                disabled={!corsText.trim() || putCors.isPending || corsDenied}
                onClick={() => putCors.mutate()}
              >
                Save CORS
              </Button>
              <Button
                variant="danger"
                disabled={delCors.isPending || corsDenied}
                onClick={() => {
                  if (confirm("Delete CORS configuration?")) delCors.mutate();
                }}
              >
                Delete CORS
              </Button>
            </div>
          </div>
        )}

        {tab === "lifecycle" && (
          <div className="max-w-3xl">
            {lifecycleQuery.isLoading && <Spinner />}
            {lifecycleDenied && (
              <p className="mb-4 text-sm text-muted">
                Lifecycle API denied by this store.
              </p>
            )}
            <Field label="Lifecycle rules (JSON array)">
              <TextArea
                rows={14}
                value={lifecycleText}
                onChange={(e) => setLifecycleText(e.target.value)}
                placeholder={LIFECYCLE_PLACEHOLDER}
              />
            </Field>
            <div className="flex gap-2">
              <Button
                variant="subtle"
                onClick={() => {
                  try {
                    setLifecycleText(
                      JSON.stringify(
                        JSON.parse(lifecycleText || "[]"),
                        null,
                        2,
                      ),
                    );
                  } catch {
                    showToast("Invalid JSON", "err");
                  }
                }}
              >
                Pretty print
              </Button>
              <Button
                disabled={
                  !lifecycleText.trim() ||
                  putLifecycle.isPending ||
                  lifecycleDenied
                }
                onClick={() => putLifecycle.mutate()}
              >
                Save lifecycle
              </Button>
              <Button
                variant="danger"
                disabled={delLifecycle.isPending || lifecycleDenied}
                onClick={() => {
                  if (confirm("Delete lifecycle configuration?")) {
                    delLifecycle.mutate();
                  }
                }}
              >
                Delete lifecycle
              </Button>
            </div>
          </div>
        )}

        {tab === "encryption" && (
          <div className="max-w-xl">
            {encQuery.isLoading && <Spinner />}
            {encDenied && (
              <p className="mb-4 text-sm text-muted">
                Encryption API denied by this store.
              </p>
            )}
            {!encDenied &&
              encQuery.data &&
              "algorithm" in encQuery.data && (
                <p className="mb-4 text-sm text-muted">
                  Current:{" "}
                  <span className="font-medium text-fg">
                    {encQuery.data.algorithm ?? "None"}
                  </span>
                </p>
              )}
            <Field label="Default encryption">
              <Select
                value={encMode}
                onChange={(e) =>
                  setEncMode(e.target.value as "sseS3" | "none")
                }
              >
                <option value="none">None</option>
                <option value="sseS3">SSE-S3 (AES256)</option>
              </Select>
            </Field>
            <Button
              disabled={putEnc.isPending || encDenied}
              onClick={() => putEnc.mutate()}
            >
              Apply encryption
            </Button>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
