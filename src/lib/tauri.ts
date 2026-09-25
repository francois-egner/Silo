import { invoke } from "@tauri-apps/api/core";
import type {
  Account,
  AclInfo,
  BucketInfo,
  CopyItem,
  DownloadItem,
  ExpandedLocalFile,
  ListObjectsResult,
  LocalEntry,
  LocalStat,
  UpsertAccountInput,
  UploadItem,
  VersioningInfo,
  EncryptionInfo,
} from "../shared/types";

async function call<T>(
  cmd: string,
  args?: Record<string, unknown>,
  opts?: { quietErrors?: RegExp },
): Promise<T> {
  console.debug(`[silo] → ${cmd}`, args ?? {});
  try {
    const result = await invoke<T>(cmd, args);
    console.debug(`[silo] ← ${cmd}`, result);
    return result;
  } catch (err) {
    const msg = String(err);
    if (opts?.quietErrors?.test(msg)) {
      console.debug(`[silo] ✖ ${cmd} (expected)`, msg);
    } else {
      console.error(`[silo] ✖ ${cmd}`, err);
    }
    throw err;
  }
}

export const api = {
  listAccounts: () => call<Account[]>("list_accounts"),
  upsertAccount: (input: UpsertAccountInput) =>
    call<Account>("upsert_account", { input }),
  deleteAccount: (id: string) => call<void>("delete_account", { id }),
  duplicateAccount: (id: string) => call<Account>("duplicate_account", { id }),
  testAccount: (args: { id?: string; input?: UpsertAccountInput }) =>
    call<string[]>("test_account", args),
  getActiveAccount: () => call<string | null>("get_active_account"),
  setActiveAccount: (id: string | null) =>
    call<void>("set_active_account", { id }),
  revealSecret: (id: string) => call<string>("reveal_secret", { id }),

  listBuckets: (accountId: string) =>
    call<BucketInfo[]>("list_buckets", { accountId }),
  createBucket: (accountId: string, name: string, region?: string) =>
    call<void>("create_bucket", { accountId, name, region: region ?? null }),
  deleteBucket: (accountId: string, name: string) =>
    call<void>("delete_bucket", { accountId, name }),
  emptyBucket: (accountId: string, name: string) =>
    call<number>("empty_bucket", { accountId, name }),

  listObjects: (
    accountId: string,
    bucket: string,
    prefix?: string,
    continuationToken?: string | null,
  ) =>
    call<ListObjectsResult>("list_objects", {
      accountId,
      bucket,
      prefix: prefix ?? "",
      continuationToken: continuationToken ?? null,
    }),
  uploadObjects: (accountId: string, bucket: string, items: UploadItem[]) =>
    call<string[]>("upload_objects", { accountId, bucket, items }),
  downloadObjects: (accountId: string, bucket: string, items: DownloadItem[]) =>
    call<string[]>("download_objects", { accountId, bucket, items }),
  deleteObjects: (accountId: string, bucket: string, keys: string[]) =>
    call<void>("delete_objects", { accountId, bucket, keys }),
  copyObject: (
    accountId: string,
    bucket: string,
    sourceKey: string,
    destKey: string,
    deleteSource: boolean,
  ) =>
    call<void>("copy_object", {
      accountId,
      bucket,
      sourceKey,
      destKey,
      deleteSource,
    }),
  copyObjects: (
    sourceAccountId: string,
    sourceBucket: string,
    destAccountId: string,
    destBucket: string,
    items: CopyItem[],
    deleteSource: boolean,
  ) =>
    call<string[]>("copy_objects", {
      sourceAccountId,
      sourceBucket,
      destAccountId,
      destBucket,
      items,
      deleteSource,
    }),
  createFolder: (accountId: string, bucket: string, prefix: string) =>
    call<void>("create_folder", { accountId, bucket, prefix }),
  presignGet: (
    accountId: string,
    bucket: string,
    key: string,
    expiresSecs?: number,
  ) =>
    call<string>("presign_get", {
      accountId,
      bucket,
      key,
      expiresSecs: expiresSecs ?? 3600,
    }),

  getBucketAcl: (accountId: string, bucket: string) =>
    call<AclInfo>(
      "get_bucket_acl",
      { accountId, bucket },
      { quietErrors: /AccessDenied/i },
    ),
  putBucketAcl: (accountId: string, bucket: string, cannedAcl: string) =>
    call<void>("put_bucket_acl", { accountId, bucket, cannedAcl }),
  getObjectAcl: (accountId: string, bucket: string, key: string) =>
    call<AclInfo>(
      "get_object_acl",
      { accountId, bucket, key },
      { quietErrors: /AccessDenied/i },
    ),
  putObjectAcl: (
    accountId: string,
    bucket: string,
    key: string,
    cannedAcl: string,
  ) => call<void>("put_object_acl", { accountId, bucket, key, cannedAcl }),
  getBucketPolicy: (accountId: string, bucket: string) =>
    call<string | null>(
      "get_bucket_policy",
      { accountId, bucket },
      { quietErrors: /AccessDenied/i },
    ),
  putBucketPolicy: (accountId: string, bucket: string, policy: string) =>
    call<void>("put_bucket_policy", { accountId, bucket, policy }),
  deleteBucketPolicy: (accountId: string, bucket: string) =>
    call<void>("delete_bucket_policy", { accountId, bucket }),

  getBucketVersioning: (accountId: string, bucket: string) =>
    call<VersioningInfo>(
      "get_bucket_versioning",
      { accountId, bucket },
      { quietErrors: /AccessDenied/i },
    ),
  putBucketVersioning: (
    accountId: string,
    bucket: string,
    status: string,
  ) => call<void>("put_bucket_versioning", { accountId, bucket, status }),
  getBucketCors: (accountId: string, bucket: string) =>
    call<string | null>(
      "get_bucket_cors",
      { accountId, bucket },
      { quietErrors: /AccessDenied/i },
    ),
  putBucketCors: (accountId: string, bucket: string, rulesJson: string) =>
    call<void>("put_bucket_cors", { accountId, bucket, rulesJson }),
  deleteBucketCors: (accountId: string, bucket: string) =>
    call<void>("delete_bucket_cors", { accountId, bucket }),
  getBucketLifecycle: (accountId: string, bucket: string) =>
    call<string | null>(
      "get_bucket_lifecycle",
      { accountId, bucket },
      { quietErrors: /AccessDenied/i },
    ),
  putBucketLifecycle: (
    accountId: string,
    bucket: string,
    rulesJson: string,
  ) => call<void>("put_bucket_lifecycle", { accountId, bucket, rulesJson }),
  deleteBucketLifecycle: (accountId: string, bucket: string) =>
    call<void>("delete_bucket_lifecycle", { accountId, bucket }),
  getBucketEncryption: (accountId: string, bucket: string) =>
    call<EncryptionInfo>(
      "get_bucket_encryption",
      { accountId, bucket },
      { quietErrors: /AccessDenied/i },
    ),
  putBucketEncryption: (accountId: string, bucket: string, mode: string) =>
    call<void>("put_bucket_encryption", { accountId, bucket, mode }),

  getHomeDir: () => call<string>("get_home_dir"),
  listLocalDir: (path: string) => call<LocalEntry[]>("list_local_dir", { path }),
  expandLocalFiles: (paths: string[]) =>
    call<ExpandedLocalFile[]>("expand_local_files", { paths }),
  statLocalPath: (path: string) => call<LocalStat>("stat_local_path", { path }),
};

export function formatBytes(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}

export function formatDate(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
