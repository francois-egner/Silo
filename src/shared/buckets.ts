import type { Account, BucketFilterMode, BucketInfo } from "./types";

export function filterVisibleBuckets<T extends { name: string }>(
  account: Pick<Account, "bucketFilterMode" | "visibleBuckets"> | null | undefined,
  buckets: T[],
): T[] {
  if (!account || account.bucketFilterMode !== "selected") return buckets;
  const allowed = new Set(account.visibleBuckets);
  return buckets.filter((b) => allowed.has(b.name));
}

export function accountShowsAllBuckets(
  account: Pick<Account, "bucketFilterMode"> | null | undefined,
): boolean {
  return !account || account.bucketFilterMode !== "selected";
}

export type { BucketFilterMode, BucketInfo };
