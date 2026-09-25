export type SortKey = "name" | "size" | "modified";
export type SortDir = "asc" | "desc";

export type SortState = { key: SortKey; dir: SortDir };

export function toggleSort(current: SortState, key: SortKey): SortState {
  if (current.key === key) {
    return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  }
  return { key, dir: key === "name" ? "asc" : "desc" };
}

export function SortHeader({
  label,
  column,
  sort,
  onSort,
  className = "",
}: {
  label: string;
  column: SortKey;
  sort: SortState;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = sort.key === column;

  return (
    <th
      className={`cursor-pointer select-none ${className}`}
      aria-sort={
        active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"
      }
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onSort(column);
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span
        className={`inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide ${
          active ? "text-accent" : "text-mist-400 hover:text-mist-200"
        }`}
      >
        {label}
        <span
          className={`font-mono text-sm leading-none ${
            active ? "text-accent opacity-100" : "opacity-40"
          }`}
          aria-hidden
        >
          {active ? (sort.dir === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </span>
    </th>
  );
}

function cmpStr(a: string, b: string) {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function cmpNum(a: number, b: number) {
  return a === b ? 0 : a < b ? -1 : 1;
}

/** Folders first, then apply sort key/dir. */
export function sortEntries<T>(
  entries: T[],
  sort: SortState,
  getters: {
    isDir: (e: T) => boolean;
    name: (e: T) => string;
    size: (e: T) => number | null | undefined;
    modified: (e: T) => string | null | undefined;
  },
): T[] {
  const dir = sort.dir === "asc" ? 1 : -1;
  return [...entries].sort((a, b) => {
    const aDir = getters.isDir(a);
    const bDir = getters.isDir(b);
    if (aDir !== bDir) return aDir ? -1 : 1;

    let primary = 0;
    if (sort.key === "name") {
      primary = cmpStr(getters.name(a), getters.name(b));
    } else if (sort.key === "size") {
      primary = cmpNum(getters.size(a) ?? 0, getters.size(b) ?? 0);
    } else {
      primary = cmpStr(getters.modified(a) ?? "", getters.modified(b) ?? "");
    }
    if (primary !== 0) return primary * dir;
    return cmpStr(getters.name(a), getters.name(b)) * dir;
  });
}
