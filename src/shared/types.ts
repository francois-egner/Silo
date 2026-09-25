export type Provider = "aws" | "minio" | "r2" | "spaces" | "wasabi" | "custom";

export type BucketFilterMode = "all" | "selected";

export interface Account {
  id: string;
  name: string;
  provider: Provider;
  region: string;
  endpointUrl: string | null;
  forcePathStyle: boolean;
  accessKeyId: string;
  bucketFilterMode: BucketFilterMode;
  visibleBuckets: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UpsertAccountInput {
  id?: string | null;
  name: string;
  provider: Provider;
  region: string;
  endpointUrl?: string | null;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey?: string | null;
  sessionToken?: string | null;
  bucketFilterMode?: BucketFilterMode;
  visibleBuckets?: string[];
}

export interface BucketInfo {
  name: string;
  creationDate: string | null;
}

export interface ObjectEntry {
  key: string;
  name: string;
  size: number | null;
  lastModified: string | null;
  etag: string | null;
  storageClass: string | null;
  isFolder: boolean;
}

export interface ListObjectsResult {
  entries: ObjectEntry[];
  isTruncated: boolean;
  nextContinuationToken: string | null;
}

export interface UploadItem {
  localPath: string;
  key: string;
}

export interface DownloadItem {
  key: string;
  localPath: string;
}

export interface CopyItem {
  sourceKey: string;
  destKey: string;
}

export interface LocalEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number | null;
  modified: string | null;
}

export interface ExpandedLocalFile {
  localPath: string;
  relativeKey: string;
}

export interface LocalStat {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  fileCount: number;
  dirCount: number;
  modified: string | null;
}

export interface VersioningInfo {
  status: string;
}

export interface EncryptionInfo {
  algorithm: string | null;
}

export type BucketSettingsTab =
  | "overview"
  | "access"
  | "policy"
  | "versioning"
  | "cors"
  | "lifecycle"
  | "encryption";

export type BrowserViewMode = "single" | "split" | "s3s3";

export interface TransferProgress {
  id: string;
  kind: string;
  key: string;
  bytes: number;
  total: number;
  status: string;
  error: string | null;
}

export interface AclGrant {
  grantee: string;
  permission: string;
}

export interface AclInfo {
  owner: string | null;
  grants: AclGrant[];
}

export const PROVIDER_PRESETS: Record<
  Provider,
  {
    label: string;
    region: string;
    endpointUrl: string;
    forcePathStyle: boolean;
  }
> = {
  aws: {
    label: "Amazon S3",
    region: "us-east-1",
    endpointUrl: "",
    forcePathStyle: false,
  },
  wasabi: {
    label: "Wasabi",
    region: "eu-central-2",
    endpointUrl: "https://s3.eu-central-2.wasabisys.com",
    forcePathStyle: true,
  },
  minio: {
    label: "MinIO",
    region: "us-east-1",
    endpointUrl: "http://127.0.0.1:9000",
    forcePathStyle: true,
  },
  r2: {
    label: "Cloudflare R2",
    region: "auto",
    endpointUrl: "https://<accountid>.r2.cloudflarestorage.com",
    forcePathStyle: true,
  },
  spaces: {
    label: "DigitalOcean Spaces",
    region: "nyc3",
    endpointUrl: "https://nyc3.digitaloceanspaces.com",
    forcePathStyle: true,
  },
  custom: {
    label: "Custom",
    region: "us-east-1",
    endpointUrl: "",
    forcePathStyle: true,
  },
};
