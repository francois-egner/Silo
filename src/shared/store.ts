import { create } from "zustand";
import type { BrowserViewMode, TransferProgress } from "../shared/types";

interface UiState {
  activeAccountId: string | null;
  selectedKeys: Set<string>;
  transferOpen: boolean;
  transfers: TransferProgress[];
  toast: { message: string; tone: "ok" | "err" | "info" } | null;
  commandOpen: boolean;
  viewMode: BrowserViewMode;
  localPath: string | null;
  s3s3DestAccountId: string | null;
  s3s3DestBucket: string | null;
  s3s3DestPrefix: string;
  setActiveAccountId: (id: string | null) => void;
  setSelectedKeys: (keys: Set<string>) => void;
  toggleKey: (key: string) => void;
  clearSelection: () => void;
  setTransferOpen: (open: boolean) => void;
  upsertTransfer: (p: TransferProgress) => void;
  clearDoneTransfers: () => void;
  showToast: (message: string, tone?: "ok" | "err" | "info") => void;
  clearToast: () => void;
  setCommandOpen: (open: boolean) => void;
  setViewMode: (mode: BrowserViewMode) => void;
  setLocalPath: (path: string | null) => void;
  setS3s3Dest: (opts: {
    accountId?: string | null;
    bucket?: string | null;
    prefix?: string;
  }) => void;
}

export const useUiStore = create<UiState>((set) => ({
  activeAccountId: null,
  selectedKeys: new Set(),
  transferOpen: false,
  transfers: [],
  toast: null,
  commandOpen: false,
  viewMode: "single",
  localPath: null,
  s3s3DestAccountId: null,
  s3s3DestBucket: null,
  s3s3DestPrefix: "",
  setActiveAccountId: (id) => set({ activeAccountId: id }),
  setSelectedKeys: (keys) => set({ selectedKeys: keys }),
  toggleKey: (key) =>
    set((s) => {
      const next = new Set(s.selectedKeys);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { selectedKeys: next };
    }),
  clearSelection: () => set({ selectedKeys: new Set() }),
  setTransferOpen: (open) => set({ transferOpen: open }),
  upsertTransfer: (p) =>
    set((s) => {
      const idx = s.transfers.findIndex((t) => t.id === p.id);
      const transfers = [...s.transfers];
      if (idx >= 0) transfers[idx] = p;
      else transfers.unshift(p);
      return { transfers, transferOpen: true };
    }),
  clearDoneTransfers: () =>
    set((s) => ({
      transfers: s.transfers.filter(
        (t) => t.status !== "done" && t.status !== "error",
      ),
    })),
  showToast: (message, tone = "info") => set({ toast: { message, tone } }),
  clearToast: () => set({ toast: null }),
  setCommandOpen: (open) => set({ commandOpen: open }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setLocalPath: (path) => set({ localPath: path }),
  setS3s3Dest: ({ accountId, bucket, prefix }) =>
    set((s) => ({
      s3s3DestAccountId:
        accountId !== undefined ? accountId : s.s3s3DestAccountId,
      s3s3DestBucket: bucket !== undefined ? bucket : s.s3s3DestBucket,
      s3s3DestPrefix: prefix !== undefined ? prefix : s.s3s3DestPrefix,
    })),
}));
