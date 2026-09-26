import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Layers3, Search } from "lucide-react";
import { api } from "../lib/tauri";
import { useUiStore } from "../shared/store";
import type { BucketSettingsTab } from "../shared/types";
import { AccountsHome } from "../features/accounts/AccountsHome";
import { BucketsView } from "../features/buckets/BucketsView";
import { ObjectBrowser } from "../features/objects/ObjectBrowser";
import {
  ToastHost,
  TransferPanel,
} from "../features/objects/TransferPanel";
import { BucketSettings } from "../features/policies/BucketSettings";
import { SectionHeader } from "../shared/ui";
import { CommandPalette } from "./CommandPalette";
import { SidebarTree, type NavTarget } from "./SidebarTree";

const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 480;
const SIDEBAR_DEFAULT = 224;
const SIDEBAR_WIDTH_KEY = "silo.sidebarWidth";

function loadSidebarWidth(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    const n = raw ? Number(raw) : SIDEBAR_DEFAULT;
    if (!Number.isFinite(n)) return SIDEBAR_DEFAULT;
    return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, n));
  } catch {
    return SIDEBAR_DEFAULT;
  }
}

type Route =
  | { name: "accounts" }
  | { name: "buckets"; accountId: string }
  | { name: "objects"; accountId: string; bucket: string; prefix: string }
  | {
      name: "settings";
      accountId: string;
      bucket: string;
      prefix: string;
      tab?: BucketSettingsTab;
    };

export function AppShell() {
  const [route, setRoute] = useState<Route>({ name: "accounts" });
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null);
  const activeId = useUiStore((s) => s.activeAccountId);
  const setActive = useUiStore((s) => s.setActiveAccountId);
  const setCommandOpen = useUiStore((s) => s.setCommandOpen);
  const showToast = useUiStore((s) => s.showToast);
  const qc = useQueryClient();

  const accounts = useQuery({ queryKey: ["accounts"], queryFn: api.listAccounts });

  useEffect(() => {
    void (async () => {
      const id = await api.getActiveAccount();
      if (id) setActive(id);
    })();
  }, [setActive]);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
    } catch {
      /* ignore */
    }
  }, [sidebarWidth]);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const drag = resizeRef.current;
      if (!drag) return;
      const next = Math.min(
        SIDEBAR_MAX,
        Math.max(SIDEBAR_MIN, drag.startW + (e.clientX - drag.startX)),
      );
      setSidebarWidth(next);
    }
    function onUp() {
      resizeRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  const sidebarAccounts = accounts.data ?? [];

  async function activateAccount(accountId: string) {
    await api.setActiveAccount(accountId);
    setActive(accountId);
  }

  async function onTreeNavigate(t: NavTarget) {
    await activateAccount(t.accountId);
    if (t.kind === "buckets") {
      setRoute({ name: "buckets", accountId: t.accountId });
      return;
    }
    if (t.kind === "settings") {
      setRoute({
        name: "settings",
        accountId: t.accountId,
        bucket: t.bucket,
        prefix: "",
        tab: t.tab ?? "overview",
      });
      return;
    }
    setRoute({
      name: "objects",
      accountId: t.accountId,
      bucket: t.bucket,
      prefix: t.prefix,
    });
  }

  async function emptyBucket(accountId: string, bucket: string) {
    if (
      !confirm(
        `Empty bucket “${bucket}”? This permanently deletes all objects.`,
      )
    ) {
      return;
    }
    try {
      const n = await api.emptyBucket(accountId, bucket);
      await qc.invalidateQueries({ queryKey: ["objects", accountId, bucket] });
      showToast(`Deleted ${n} object(s)`, "ok");
    } catch (e) {
      showToast(String(e), "err");
    }
  }

  async function deleteBucket(accountId: string, bucket: string) {
    if (
      !confirm(
        `Delete bucket “${bucket}”? The bucket must be empty.`,
      )
    ) {
      return;
    }
    try {
      await api.deleteBucket(accountId, bucket);
      await qc.invalidateQueries({ queryKey: ["buckets", accountId] });
      if (
        (route.name === "objects" || route.name === "settings") &&
        route.bucket === bucket
      ) {
        setRoute({ name: "buckets", accountId });
      }
      showToast("Bucket deleted", "ok");
    } catch (e) {
      showToast(String(e), "err");
    }
  }

  const treeActive = {
    accountId:
      route.name === "accounts"
        ? activeId ?? undefined
        : "accountId" in route
          ? route.accountId
          : undefined,
    bucket:
      route.name === "objects" || route.name === "settings"
        ? route.bucket
        : undefined,
    prefix:
      route.name === "objects" || route.name === "settings"
        ? route.prefix
        : undefined,
  };

  return (
    <div className="relative flex h-full bg-app text-fg">
      <aside
        className="relative z-10 flex shrink-0 flex-col border-r border-line bg-sidebar"
        style={{ width: sidebarWidth }}
      >
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
          <img
            src="/silo-icon.png"
            alt=""
            width={20}
            height={20}
            className="h-5 w-5 shrink-0 rounded"
          />
          <div className="text-[13px] font-semibold tracking-tight">Silo</div>
        </div>

        <nav className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="px-1.5 pt-1.5">
            <button
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] ${
                route.name === "accounts"
                  ? "bg-selected text-on-accent"
                  : "text-fg hover:bg-hover"
              }`}
              onClick={() => setRoute({ name: "accounts" })}
            >
              <Layers3 size={14} /> Accounts
            </button>
          </div>

          <SectionHeader>Browser</SectionHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
            <SidebarTree
              accounts={sidebarAccounts}
              active={treeActive}
              onNavigate={(t) => void onTreeNavigate(t)}
              bucketActions={{
                onEmptyBucket: (accountId, bucket) =>
                  void emptyBucket(accountId, bucket),
                onDeleteBucket: (accountId, bucket) =>
                  void deleteBucket(accountId, bucket),
              }}
            />
          </div>
        </nav>

        <button
          className="m-2 flex h-7 items-center gap-2 rounded-md border border-line bg-panel px-2 text-[12px] text-muted hover:bg-hover hover:text-fg"
          onClick={() => setCommandOpen(true)}
        >
          <Search size={12} />
          Search
          <span className="ml-auto font-mono text-[10px] opacity-70">⌘K</span>
        </button>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          title="Drag to resize"
          className="absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize touch-none hover:bg-accent/25 active:bg-accent/40"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            resizeRef.current = { startX: e.clientX, startW: sidebarWidth };
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
          }}
        />
      </aside>

      <main className="relative z-10 min-w-0 flex-1 overflow-hidden bg-app">
        {route.name === "accounts" && (
          <AccountsHome
            onOpenBuckets={(accountId) =>
              setRoute({ name: "buckets", accountId })
            }
          />
        )}
        {route.name === "buckets" && (
          <BucketsView
            accountId={route.accountId}
            onBack={() => setRoute({ name: "accounts" })}
            onOpenBucket={(bucket) =>
              setRoute({
                name: "objects",
                accountId: route.accountId,
                bucket,
                prefix: "",
              })
            }
            onOpenSettings={(bucket) =>
              setRoute({
                name: "settings",
                accountId: route.accountId,
                bucket,
                prefix: "",
                tab: "overview",
              })
            }
          />
        )}
        {route.name === "objects" && (
          <ObjectBrowser
            accountId={route.accountId}
            bucket={route.bucket}
            prefix={route.prefix}
            onPrefixChange={(prefix) =>
              setRoute({
                name: "objects",
                accountId: route.accountId,
                bucket: route.bucket,
                prefix,
              })
            }
            onOpenSettings={() =>
              setRoute({
                name: "settings",
                accountId: route.accountId,
                bucket: route.bucket,
                prefix: route.prefix,
                tab: "overview",
              })
            }
          />
        )}
        {route.name === "settings" && (
          <BucketSettings
            accountId={route.accountId}
            bucket={route.bucket}
            initialTab={route.tab ?? "overview"}
            onOpenBucket={() =>
              setRoute({
                name: "objects",
                accountId: route.accountId,
                bucket: route.bucket,
                prefix: "",
              })
            }
            onBack={() =>
              setRoute({
                name: "objects",
                accountId: route.accountId,
                bucket: route.bucket,
                prefix: route.prefix,
              })
            }
            onDeleted={() =>
              setRoute({ name: "buckets", accountId: route.accountId })
            }
          />
        )}
      </main>

      <TransferPanel />
      <ToastHost />
      <CommandPalette
        onGoAccounts={() => setRoute({ name: "accounts" })}
        onGoBuckets={(accountId) => setRoute({ name: "buckets", accountId })}
        onOpenBucket={(accountId, bucket) =>
          setRoute({ name: "objects", accountId, bucket, prefix: "" })
        }
      />
    </div>
  );
}
