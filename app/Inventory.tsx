"use client";
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { apiFetch, appHome } from "../lib/client-api";
import {
  Layers3,
  Upload,
  Download,
  Search,
  Settings2,
  SlidersHorizontal,
  Columns3,
  RefreshCw,
  X,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  GripVertical,
  Check,
  AlertCircle,
  Clock3,
  LoaderCircle,
  ExternalLink,
} from "lucide-react";
import {
  inventoryColumns,
  marketColumns,
  normalizeFilters,
  csvColumnKey,
  defaults,
  emptyFilters,
  formatValue,
  type Preferences,
  type Filters,
  type ImportRow,
} from "../lib/domain";
import { type Mapping } from "../lib/csv";
import ImportWorker from "../lib/import.worker?worker";

const HistoryChart = lazy(() => import("./HistoryChart"));
type RecordValue = Record<string, any>;
type Metadata = {
  headers: string[];
  historyFrom: number | null;
  historyTo: number | null;
  filename: string | null;
  importedAt: number | null;
  updatedAt: number | null;
  settings: Preferences;
  connected: boolean;
  serverManagedKey: boolean;
  usage: RecordValue;
  uniqueProducts: number;
  analyzedProducts: number;
  unanalyzedProducts: number;
  unresolvedProducts: number;
  importing: string | null;
  uniqueCards: number;
  totalCards: number;
  refresh: RecordValue | null;
};
type Result = {
  rows: RecordValue[];
  page: number;
  pageSize: number;
  matches: number;
  units: number;
  lastRefreshed: number | null;
};
const initialResult: Result = {
  rows: [],
  page: 1,
  pageSize: 50,
  matches: 0,
  units: 0,
  lastRefreshed: null,
};
async function api<T = any>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await apiFetch("/api/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
    cache: "no-store",
  });
  const result = (await response.json()) as RecordValue;
  if (!response.ok)
    throw new Error(result.error ?? "The request could not be completed.");
  return result as T;
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
  error,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  error?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "modal wide" : "modal"}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {error && (
        <p className="modal-error" role="alert">
          {error}
        </p>
      )}
      {children}
    </dialog>
  );
}
function CategoryFilter({
  name,
  values,
  chosen,
  onChange,
}: {
  name: string;
  values: string[];
  chosen: string[];
  onChange: (values: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  return (
    <fieldset className="category">
      <legend>{name}</legend>
      {values.length > 8 && (
        <input
          placeholder={"Find " + name.toLowerCase()}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      )}
      <div>
        {values
          .filter((value) => value.toLowerCase().includes(search.toLowerCase()))
          .map((value) => (
            <label key={value}>
              <input
                type="checkbox"
                checked={chosen.includes(value)}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...chosen, value]
                      : chosen.filter((item) => item !== value),
                  )
                }
              />
              <span>{value}</span>
            </label>
          ))}
        {!values.length && (
          <span className="muted small">No values imported</span>
        )}
      </div>
    </fieldset>
  );
}
function runImportWorker(
  text: string,
  operation: string,
  mapping?: Mapping,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const worker = new ImportWorker();
    worker.onmessage = (event) => {
      worker.terminate();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data);
    };
    worker.onerror = () => {
      worker.terminate();
      reject(
        new Error(
          "The CSV parser could not start. Reload the page and try again.",
        ),
      );
    };
    worker.postMessage({ text, operation, mapping });
  });
}
const quickViews = [
  ["all", "All inventory"], ["most", "Most sold"], ["least", "Least sold"],
  ["noSales", "Zero reported sales"], ["missing", "Missing sales history"], ["outdated", "Outdated sales history"],
];
const dateInput = (value: number | null | undefined) => value == null ? "" : new Date(value).toISOString().slice(0,10);

const dateLabel = (value: number | null | undefined) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Never";

export default function Inventory({onSignOut}:{onSignOut?:()=>void}={}) {
  const [meta, setMeta] = useState<Metadata | null>(null),
    [result, setResult] = useState<Result>(initialResult);
  const [filters, setFilters] = useState<Filters>(emptyFilters),
    [sort, setSort] = useState("rowNo"),
    [direction, setDirection] = useState("asc");
  const [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(50),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [facets, setFacets] = useState<Record<string, string[]>>({}),
    [selected, setSelected] = useState<Set<string>>(new Set());
  const [advanced, setAdvanced] = useState(false),
    [view, setView] = useState("all"),
    [modal, setModal] = useState<
      "settings" | "columns" | "refresh" | "export" | "preset" | "account" | null
    >(null);
  const [settings, setSettings] = useState<Preferences>(defaults),
    [saving, setSaving] = useState(false);
  const [accountReport,setAccountReport]=useState<RecordValue|null>(null), [accountBusy,setAccountBusy]=useState(false), [productDraft,setProductDraft]=useState("");
  const [saveName, setSaveName] = useState(""),
    [dragColumn, setDragColumn] = useState<string | null>(null),
    [dropColumn, setDropColumn] = useState<string | null>(null);
  const touchDrag = useRef<string | null>(null);
  const [card, setCard] = useState<RecordValue | null>(null),
    [cardLoading, setCardLoading] = useState(false);
  const [file, setFile] = useState<{
    name: string;
    text: string;
    headers: string[];
    mapping: Mapping;
    count: number;
    preview: string[][];
    mode: string;
  } | null>(null);
  const [fileBusy, setFileBusy] = useState(false),
    [importProgress, setImportProgress] = useState(0),
    [importId, setImportId] = useState<string | null>(null),
    [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [scope, setScope] = useState("all"),
    [plan, setPlan] = useState<RecordValue | null>(null),
    [planBusy, setPlanBusy] = useState(false);
  const [refresh, setRefresh] = useState<RecordValue | null>(null),
    [refreshRunning, setRefreshRunning] = useState(false),
    [refreshErrors, setRefreshErrors] = useState<string[]>([]);
  const [exportScope, setExportScope] = useState("filtered"),
    [exportAnalysis, setExportAnalysis] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null),
    importMode = useRef("upload"),
    refreshCancelled = useRef(false),
    uploadAbort = useRef<AbortController | null>(null),
    lastAutomatic = useRef(Date.now());
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    [search, setSearch] = useState("");
  const latest = useRef({ filters, sort, direction, meta });
  const columnSaveQueue = useRef<Promise<unknown>>(Promise.resolve());
  latest.current = { filters, sort, direction, meta };
  const hasInventory = !!meta?.filename;
  const columns = inventoryColumns(meta?.headers ?? []);
  const selectedCardRow = result.rows.find(row => row.key === card?.card?.key);
  const hasFilters =
    !!filters.search ||
    filters.numeric.length > 0 ||
    Object.values(filters.categories).some((values) => values.length) ||
    filters.freshness !== "all" ||
    !!filters.dateFrom ||
    !!filters.dateTo ||
    filters.limit > 0;
  const visible = settings.visibleColumns
    .map((key) => columns.find((column) => column.key === key)!)
    .filter(Boolean);
  const query = { filters, sort, direction, page, pageSize };
  const scopeQuery = (choice: string) => ({
    filters: choice === "all" || choice === "selected" ? emptyFilters : filters,
    sort,
    direction,
    ...(choice === "selected" ? { selected: [...selected] } : {}),
  });
  const refreshOptions={prioritizeUnanalyzed:settings.prioritizeUnanalyzed,maxProducts:settings.maxProducts};
  const showError = (problem: unknown) =>
    setError(problem instanceof Error ? problem.message : String(problem));
  const changeFilters = (next: Filters) => {
    setError("");
    setFilters(next);
    setPage(1);
    setSelected(new Set());
    setView("custom");
  };
  const loadMetadata = async () => {
    const data = await api<Metadata>("state");
    setMeta(data);
    if(data.connected) void api("account").then(usage=>setMeta(current=>current?{...current,usage}:current)).catch(problem=>setMeta(current=>current?{...current,usage:{...current.usage,accountError:problem.message}}:current));
    setSettings(data.settings);
    setFacets(await api("facets"));
    if (data.refresh?.status === "running") setRefresh(data.refresh);
    return data;
  };
  useEffect(() => {
    let active = true;
    void loadMetadata()
      .then(() => {
        if (!active) return;
        try {
          const saved = JSON.parse(
            localStorage.getItem("sortswift-view") ?? "null",
          );
          if (saved) {
            setFilters(normalizeFilters(saved.filters));
            setSearch(saved.filters?.search ?? "");
            setSort(saved.sort ?? "rowNo");
            setDirection(saved.direction ?? "asc");
          }
        } catch {}
      })
      .catch(showError)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!meta) return;
    const controller = new AbortController();
    setLoading(true);
    void api<Result>(
      "cards?q=" + encodeURIComponent(JSON.stringify(query)),
      undefined,
      controller.signal,
    )
      .then(setResult)
      .catch((problem) => {
        if (problem.name !== "AbortError") showError(problem);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    localStorage.setItem(
      "sortswift-view",
      JSON.stringify({ filters, sort, direction }),
    );
    return () => controller.abort();
  }, [meta, filters, sort, direction, page, pageSize]);
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      if (search !== latest.current.filters.search) {
        setFilters((current) => ({ ...current, search }));
        setPage(1);
      }
    }, 180);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [search]);
  const updateSettings = async (next: Preferences, extra?: RecordValue) => {
    const data = await api<Metadata>("preferences", {
      settings: next,
      ...extra,
    });
    setMeta(data);
    setSettings(data.settings);
    return data;
  };
  const changeColumns = (visibleColumns: string[]) => {
    const next = {...settings, visibleColumns, columnSelectionVersion: 1};
    setSettings(next);
    // Serialize saves so rapid clicks cannot let an older selection win.
    const job = columnSaveQueue.current.catch(() => {}).then(() => api<Metadata>("preferences", {
      settings: {visibleColumns, columnSelectionVersion: 1, knownCsvColumns: next.knownCsvColumns},
    })).then(data => setMeta(current => current ? {...current, settings: data.settings} : current));
    columnSaveQueue.current = job;
    void job.catch(showError);
  };
  const chooseView = (value: string) => {
    setView(value);
    setPage(1);
    setSelected(new Set());
    setSearch("");
    const saved = value.startsWith("saved:")
      ? settings.presets[Number(value.slice(6))]
      : null;
    if (saved) {
      setFilters(normalizeFilters(saved.filters));
      setSearch(saved.filters.search);
      setSort(saved.sort);
      setDirection(saved.direction);
      return;
    }
    const next: Filters = {...structuredClone(emptyFilters), dateFrom: filters.dateFrom, dateTo: filters.dateTo};
    const field = value === "all" ? "rowNo" : "unitsSold";
    const dir = value === "least" || value === "all" ? "asc" : "desc";
    if (value === "noSales") next.numeric = [{field: "unitsSold", min: "0", max: "0"}];
    if (value === "missing" || value === "outdated") next.freshness = value;
    setFilters(next);
    setSort(field);
    setDirection(dir);
  };
  const readFile = async (input: File, mode: string) => {
    setError("");
    setFileBusy(true);
    setReplaceConfirmed(false);
    setImportProgress(0);
    try {
      const text = await input.text(),
        analysis = await runImportWorker(text, "analyze");
      const savedIdColumn = localStorage.getItem("sortswift-product-id-column");
      if (savedIdColumn && analysis.headers.includes(savedIdColumn)) analysis.mapping.productId = savedIdColumn;
      setFile({ name: input.name, text, mode, ...analysis });
    } catch (problem) {
      showError(problem);
    } finally {
      setFileBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  const openFile = (mode: string) => {
    importMode.current = mode;
    fileInput.current?.click();
  };
  const upload = async () => {
    if (!file) return;
    setFileBusy(true);
    setError("");
    const controller = new AbortController();
    uploadAbort.current = controller;
    let id: string | null = null;
    try {
      const prepared: { headers: string[]; rows: ImportRow[] } =
        await runImportWorker(file.text, "prepare", file.mapping);
      localStorage.setItem("sortswift-product-id-column", file.mapping.productId);
      const started = await api<{ id: string }>(
        "imports/start",
        {
          mode: file.mode,
          filename: file.name,
          headers: prepared.headers,
          count: prepared.rows.length,
        },
        controller.signal,
      );
      id = started.id;
      setImportId(id);
      for (let start = 0; start < prepared.rows.length; ) {
        let end = Math.min(start + 500, prepared.rows.length);
        while (
          end - start > 1 &&
          JSON.stringify(prepared.rows.slice(start, end)).length > 650000
        )
          end = start + Math.floor((end - start) / 2);
        await api(
          "imports/chunk",
          { id, start, rows: prepared.rows.slice(start, end) },
          controller.signal,
        );
        start = end;
        setImportProgress(Math.round((start / prepared.rows.length) * 95));
      }
      const data = await api<Metadata>(
        "imports/commit",
        { id },
        controller.signal,
      );
      setMeta(data);
      setSettings(data.settings);
      setFacets(await api("facets"));
      setFile(null);
      setImportId(null);
      setSelected(new Set());
      setFilters(emptyFilters);
      setSearch("");
      setSort("rowNo");
      setDirection("asc");
      setPage(1);
      setNotice(
        "Inventory saved. Market data will refresh only when you request it.",
      );
      setImportProgress(100);
    } catch (problem) {
      if (id) await api("imports/cancel", { id }).catch(() => {});
      if ((problem as Error).name !== "AbortError") showError(problem);
    } finally {
      setFileBusy(false);
      setImportId(null);
      uploadAbort.current = null;
    }
  };
  const cancelUpload = () => {
    uploadAbort.current?.abort();
    if (importId) void api("imports/cancel", { id: importId }).catch(showError);
    setFile(null);
    setImportId(null);
  };
  useEffect(() => {
    if (modal !== "refresh") return;
    let active = true;
    setPlanBusy(true);
    void api("market/plan", { ...scopeQuery(scope), onlyStale: true, ...refreshOptions })
      .then((value) => {
        if (active) setPlan(value);
      })
      .catch(showError)
      .finally(() => {
        if (active) setPlanBusy(false);
      });
    return () => {
      active = false;
    };
  }, [
    modal,
    scope,
    selected,
    settings.maxProducts,
    settings.prioritizeUnanalyzed,
  ]);
  const runRefresh = async () => {
    setError("");
    setRefreshErrors([]);
    setRefreshRunning(true);
    refreshCancelled.current = false;
    setModal(null);
    try {
      const started = await api("market/start", {
        ...scopeQuery(scope),
        onlyStale: true,
        ...refreshOptions,
        approvedCost: plan?.maximumCredits,
      });
      setRefresh({
        ...started,
        completed: 0,
        failed: 0,
        spent: 0,
        status: "running",
        detail: JSON.stringify({
          requests: 0,
          failedRequests: 0,
          maximumRequests: started.maximumRequests,
        }),
      });
      for (const key of started.keys) {
        if (refreshCancelled.current) break;
        const progress = await api("market/step", { id: started.id, key });
        setRefresh(progress);
        if (progress.error)
          setRefreshErrors((current) => [...current, progress.error].slice(-5));
        if (progress.status !== "running") break;
      }
      await loadMetadata();
    } catch (problem) {
      if (!refreshCancelled.current) showError(problem);
    } finally {
      setRefreshRunning(false);
    }
  };
  const stopRefresh = async () => {
    refreshCancelled.current = true;
    if (refresh?.id) {
      await api("market/cancel", { id: refresh.id });
      setRefresh((current) =>
        current ? { ...current, status: "cancelled" } : null,
      );
    }
    setRefreshRunning(false);
    setNotice(
      "Refresh cancelled. Completed requests and your previous data are saved.",
    );
  };
  useEffect(()=>{document.documentElement.dataset.theme=settings.theme;localStorage.setItem("sortswift-theme",settings.theme);},[settings.theme]);
  useEffect(()=>{
    if(modal!=="account")return;
    setAccountReport(null);
    setAccountBusy(true);
    void api("account/details").then(report=>{setAccountReport(report);setMeta(current=>current?{...current,usage:report.snapshot}:current);}).catch(showError).finally(()=>setAccountBusy(false));
  },[modal]);
  const exportFile = async () => {
    setSaving(true);
    setError("");
    try {
      const response = await apiFetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...scopeQuery(exportScope),
          analysis: exportAnalysis,
        }),
      });
      if (!response.ok)
        throw new Error(
          ((await response.json()) as RecordValue).error ??
            "Could not export inventory.",
        );
      const blob = await response.blob(),
        url = URL.createObjectURL(blob),
        anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = exportAnalysis
        ? "sortswift-market-analysis.csv"
        : "tcgplayer-inventory.csv";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setModal(null);
    } catch (problem) {
      showError(problem);
    } finally {
      setSaving(false);
    }
  };
  const openCard = async (row: RecordValue) => {
    setCardLoading(true);
    setCard({ card: row });
    try {
      setCard(await api("card?key=" + encodeURIComponent(row.key)));
    } catch (problem) {
      showError(problem);
      setCard(null);
    } finally {
      setCardLoading(false);
    }
  };
  const swapColumns = (from: string, to: string) => {
    if (from === to || !visible.some(column => column.key === from) || !visible.some(column => column.key === to)) return;
    const list = [...settings.visibleColumns],
      index = list.indexOf(from),
      target = list.indexOf(to);
    [list[index], list[target]] = [list[target], list[index]];
    changeColumns(list);
  };
  const finishColumnDrag = () => {touchDrag.current = null;setDragColumn(null);setDropColumn(null);};
  const columnAt = (x: number, y: number) => document.elementFromPoint(x,y)?.closest<HTMLElement>("[data-column-key]")?.dataset.columnKey;
  const activeRefresh = refreshRunning || refresh?.status === "running";
  const progress = refresh?.total
    ? Math.min(
        100,
        (Number(refresh.completed ?? 0) / Number(refresh.total)) * 100,
      )
    : 0;
  const refreshDetail = refresh?.detail ? JSON.parse(refresh.detail) : {};
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href={appHome()}>
          <span className="brand-icon">
            <Layers3 size={22} />
          </span>
          <span className="wordmark">
            SortSwift <span>Market</span>
          </span>
        </a>
        <div className="topbar-actions">
          <button className="button subtle credit-balance" onClick={()=>{setError("");setModal("account");}} title="View account usage and free credit reset">
            {meta?.usage?.available!==undefined ? Number(meta.usage.available).toLocaleString()+" free credits available" : "Free credits · not connected"}
          </button>
          {onSignOut && <button className="button subtle" onClick={onSignOut}>Sign out</button>}
          <span className="connection">
            <i className={meta?.connected ? "connected" : ""} />
            {meta?.connected
              ? "API.SH connected"
              : "Market data not connected"}
          </span>
          <button
            className="button subtle"
            onClick={() => {
              setModal("settings");
            }}
          >
            <Settings2 size={17} />
            Settings
          </button>
        </div>
      </header>
      <main>
        <div className="page-heading">
          <div>
            <h1>Inventory</h1>
          </div>
          {hasInventory && (
            <div className="actions">
              {hasInventory && (
                <>
                  <button
                    className="button"
                    disabled={fileBusy || activeRefresh}
                    onClick={() => openFile("update")}
                  >
                    <Upload size={16} />
                    Update CSV
                  </button>
                  <button
                    className="button"
                    disabled={fileBusy || activeRefresh}
                    onClick={() => openFile("replace")}
                  >
                    Replace CSV
                  </button>
                </>
              )}
              <button
                className="button primary"
                disabled={!hasInventory || activeRefresh || fileBusy}
                onClick={() => {
                  setPlan(null);
                  setScope("all");
                  setModal("refresh");
                }}
              >
                <RefreshCw size={16} />
                Pull Sales History
              </button>
            </div>
          )}
        </div>
        {hasInventory && <p className="coverage-line">
          <button className="text-button" onClick={()=>changeFilters({...filters,freshness:"analyzed"})}>{Number(meta?.analyzedProducts??0).toLocaleString()} products analyzed</button>
          <span>·</span><button className="text-button" onClick={()=>changeFilters({...filters,freshness:"unanalyzed"})}>{Number(meta?.unanalyzedProducts??0).toLocaleString()} known products unanalyzed</button>
          {!!meta?.unresolvedProducts && <span>· {meta.unresolvedProducts.toLocaleString()} SKU groups need Product IDs</span>}
        </p>}
        {error && (
          <div className="banner error" role="alert">
            <AlertCircle size={18} />
            <span>{error}</span>
            <button
              className="icon-button"
              onClick={() => setError("")}
              aria-label="Dismiss error"
            >
              <X size={16} />
            </button>
          </div>
        )}
        {notice && (
          <div className="banner notice" role="status">
            <Check size={17} />
            <span>{notice}</span>
            <button
              className="icon-button"
              onClick={() => setNotice("")}
              aria-label="Dismiss notification"
            >
              <X size={16} />
            </button>
          </div>
        )}
        {meta?.importing && !fileBusy && (
          <div className="banner error">
            <AlertCircle size={18} />
            <span>
              An earlier CSV import is unfinished. Your saved inventory is
              available.
            </span>
            <button
              className="text-button"
              onClick={() =>
                void api("imports/cancel", { id: meta.importing })
                  .then(loadMetadata)
                  .catch(showError)
              }
            >
              Discard unfinished import
            </button>
          </div>
        )}
        {hasInventory && (
          <div className="inventory-meta">
            <span>
              <FileSpreadsheet size={16} />
              <strong>{meta?.filename}</strong>
            </span>
            <span>
              {Number(meta?.uniqueCards ?? 0).toLocaleString()} rows
            </span>
            <span>Imported {dateLabel(meta?.importedAt)}</span>
            <span>Updated {dateLabel(meta?.updatedAt)}</span>
          </div>
        )}
        {refresh && (
          <section
            className="refresh-progress"
            aria-label="Market refresh progress"
          >
            <div>
              <strong>
                {activeRefresh
                  ? "Refreshing market data"
                  : refresh.status === "cancelled"
                    ? "Refresh cancelled"
                    : "Market refresh finished"}
              </strong>
              <span className="muted">
                {refresh.completed ?? 0} card lookups completed ·{" "}
                {Math.max(0, (refresh.total ?? 0) - (refresh.completed ?? 0))}{" "}
                remaining · {refresh.failed ?? 0} failed
              </span>
              {activeRefresh && (
                <button
                  className="button small-button"
                  onClick={() => void stopRefresh().catch(showError)}
                >
                  Cancel refresh
                </button>
              )}
              {!activeRefresh && (
                <button
                  className="icon-button"
                  aria-label="Dismiss refresh summary"
                  onClick={() => setRefresh(null)}
                >
                  <X size={17} />
                </button>
              )}
            </div>
            <progress max={100} value={progress} />
            <p className="small muted">
              {refreshDetail.requests ?? 0} API requests ·{" "}
              {refreshDetail.failedRequests ?? 0} failed requests · up to{" "}
              {activeRefresh
                ? Math.max(
                    0,
                    (refreshDetail.maximumRequests ?? 0) -
                      (refreshDetail.requests ?? 0),
                  )
                : 0}{" "}
              requests remaining (estimate) ·{" "}
              {Number(refresh.spent ?? 0).toLocaleString()}{" "}
              {meta?.usage.unit ?? "credits"} used.{" "}
              {meta?.usage.remaining !== null &&
              meta?.usage.remaining !== undefined
                ? Number(meta.usage.remaining).toLocaleString() + " remaining."
                : ""}
            </p>
            {refreshErrors.length > 0 && (
              <details>
                <summary>Request issues</summary>
                {refreshErrors.map((message, index) => (
                  <p className="small" key={index}>
                    {message}
                  </p>
                ))}
              </details>
            )}
          </section>
        )}
        <section className="inventory-panel">
          {hasInventory && (
            <div className="table-toolbar">
              <div className="search-field">
                <Search size={17} />
                <input
                  aria-label="Search inventory"
                  placeholder="Search any CSV column or Product ID…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                {search && (
                  <button
                    className="icon-button"
                    aria-label="Clear search"
                    onClick={() => setSearch("")}
                  >
                    <X size={15} />
                  </button>
                )}
              </div>
              <div className="toolbar-actions">
                <select
                  aria-label="Quick filter"
                  value={view}
                  onChange={(event) => chooseView(event.target.value)}
                >
                  <option value="custom" hidden>
                    Custom view
                  </option>
                  {quickViews.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                  {settings.presets.length > 0 && (
                    <optgroup label="Saved views">
                      {settings.presets.map((preset, index) => (
                        <option key={index} value={"saved:" + index}>
                          {preset.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <button
                  className={advanced ? "button active" : "button"}
                  aria-expanded={advanced}
                  onClick={() => setAdvanced(!advanced)}
                >
                  <SlidersHorizontal size={16} />
                  Filters
                  {hasFilters && (
                    <span className="filter-count">
                      {filters.numeric.length +
                        Object.values(filters.categories).filter(
                          (values) => values.length,
                        ).length +
                        (filters.freshness !== "all" ? 1 : 0) +
                        (filters.search ? 1 : 0) +
                        (filters.dateFrom || filters.dateTo ? 1 : 0)}
                    </span>
                  )}
                </button>
                <button
                  className="button"
                  aria-label="Table columns"
                  onClick={() => setModal("columns")}
                >
                  <Columns3 size={16} />
                  <span className="optional-label">Columns</span>
                </button>
                <button
                  className="button"
                  aria-label="Export inventory"
                  disabled={!hasInventory}
                  onClick={() => {
                    setExportScope(selected.size ? "selected" : "filtered");
                    setModal("export");
                  }}
                >
                  <Download size={16} />
                  <span className="optional-label">Export</span>
                </button>
              </div>
            </div>
          )}
          {hasInventory && <section className="sales-date-filter" aria-label="Sales date range">
            <strong>Sales dates</strong>
            <label>From<input aria-label="Sales from" type="date" max={filters.dateTo || undefined} value={filters.dateFrom} onChange={event => changeFilters({...filters, dateFrom: event.target.value})}/></label>
            <label>To<input aria-label="Sales to" type="date" min={filters.dateFrom || undefined} value={filters.dateTo} onChange={event => changeFilters({...filters, dateTo: event.target.value})}/></label>
            <button className="button small-button" disabled={!filters.dateFrom && !filters.dateTo} onClick={() => changeFilters({...filters,dateFrom:"",dateTo:""})}>All dates</button>
            <p className="small muted">{meta?.historyFrom != null && meta?.historyTo != null ? "Saved history: " + dateInput(meta.historyFrom) + " to " + dateInput(meta.historyTo) + ". " : "Pull sales history to load the available dates. "}Filters use saved quantities only. Weekly totals are selected by their reported date; exact daily counts are unavailable.</p>
          </section>}
          {advanced && (
            <section className="filter-panel" aria-label="Advanced filters">
              <div className="filter-categories">
                {["set", "condition", "printing", "language", "rarity"].map(
                  (field) => (
                    <CategoryFilter
                      key={field}
                      name={field[0].toUpperCase() + field.slice(1)}
                      values={facets[field] ?? []}
                      chosen={filters.categories[field] ?? []}
                      onChange={(values) =>
                        changeFilters({
                          ...filters,
                          categories: {
                            ...filters.categories,
                            [field]: values,
                          },
                        })
                      }
                    />
                  ),
                )}
              </div>
              <div className="numeric-filters">
                {filters.numeric.map((filter, index) => (
                  <div className="numeric-filter" key={index}>
                    <select
                      aria-label="Numeric filter column"
                      value={filter.field}
                      onChange={(event) =>
                        changeFilters({
                          ...filters,
                          numeric: filters.numeric.map((item, i) =>
                            i === index
                              ? { ...item, field: event.target.value }
                              : item,
                          ),
                        })
                      }
                    >
                      {columns
                        .filter((column) =>
                          ["money", "number", "percent", "score"].includes(
                            column.kind,
                          ),
                        )
                        .map((column) => (
                          <option key={column.key} value={column.key}>
                            {column.label}
                          </option>
                        ))}
                    </select>
                    <input
                      aria-label="Minimum"
                      placeholder="Min"
                      type="number"
                      value={filter.min}
                      onChange={(event) =>
                        changeFilters({
                          ...filters,
                          numeric: filters.numeric.map((item, i) =>
                            i === index
                              ? { ...item, min: event.target.value }
                              : item,
                          ),
                        })
                      }
                    />
                    <span>to</span>
                    <input
                      aria-label="Maximum"
                      placeholder="Max"
                      type="number"
                      value={filter.max}
                      onChange={(event) =>
                        changeFilters({
                          ...filters,
                          numeric: filters.numeric.map((item, i) =>
                            i === index
                              ? { ...item, max: event.target.value }
                              : item,
                          ),
                        })
                      }
                    />
                    <button
                      className="icon-button"
                      aria-label="Remove numeric filter"
                      onClick={() =>
                        changeFilters({
                          ...filters,
                          numeric: filters.numeric.filter(
                            (_, i) => i !== index,
                          ),
                        })
                      }
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
                <button
                  className="text-button"
                  onClick={() =>
                    changeFilters({
                      ...filters,
                      numeric: [
                        ...filters.numeric,
                        { field: "unitsSold", min: "", max: "" },
                      ],
                    })
                  }
                >
                  + Add a numeric filter
                </button>
              </div>
              <div className="filter-bottom">
                <label>
                  Market data
                  <select
                    value={filters.freshness}
                    onChange={(event) =>
                      changeFilters({
                        ...filters,
                        freshness: event.target.value,
                      })
                    }
                  >
                    <option value="all">Any availability</option>
                    <option value="fresh">Fresh</option>
                    <option value="missing">Missing</option>
                    <option value="analyzed">Analyzed</option>
                    <option value="unanalyzed">Unanalyzed</option>
                    <option value="outdated">Outdated</option>
                  </select>
                </label>
                <div className="filter-save">
                  <button
                    className="button"
                    onClick={() => {
                      setSaveName("");
                      setModal("preset");
                    }}
                  >
                    Save view
                  </button>
                  <button
                    className="text-button"
                    onClick={() => chooseView("all")}
                  >
                    Reset filters
                  </button>
                </div>
              </div>
            </section>
          )}
          {selected.size > 0 && (
            <div className="selection-bar">
              <strong>{selected.size.toLocaleString()} selected</strong>
              <button
                className="text-button"
                onClick={() => {
                  setScope("selected");
                  setModal("refresh");
                }}
              >
                Pull selected sales history
              </button>
              <button
                className="text-button"
                onClick={() => {
                  setExportScope("selected");
                  setModal("export");
                }}
              >
                Export selected
              </button>
              <button
                className="text-button muted"
                onClick={() => setSelected(new Set())}
              >
                Clear selection
              </button>
            </div>
          )}
          {hasInventory ? (
            <>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th className="checkbox-cell">
                        <input
                          type="checkbox"
                          aria-label="Select this page"
                          checked={
                            result.rows.length > 0 &&
                            result.rows.every((row) => selected.has(row.key))
                          }
                          onChange={(event) => {
                            const next = new Set(selected);
                            for (const row of result.rows)
                              if (event.target.checked) next.add(row.key);
                              else next.delete(row.key);
                            setSelected(next);
                          }}
                        />
                      </th>
                      {visible.map((column) => (
                        <th
                          key={column.key}
                          aria-sort={
                            sort === column.key
                              ? direction === "asc"
                                ? "ascending"
                                : "descending"
                              : "none"
                          }
                        >
                          <button
                            title={column.note ?? "Sort by " + column.label}
                            onClick={() => {
                              if (sort === column.key)
                                setDirection(
                                  direction === "asc" ? "desc" : "asc",
                                );
                              else {
                                setSort(column.key);
                                setDirection(
                                  column.kind === "text" ? "asc" : "desc",
                                );
                              }
                              setPage(1);
                            }}
                          >
                            {column.label}
                            {sort === column.key &&
                              (direction === "asc" ? (
                                <ChevronUp size={13} />
                              ) : (
                                <ChevronDown size={13} />
                              ))}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row) => (
                      <tr
                        key={row.key}
                        tabIndex={0}
                        onClick={() => void openCard(row)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void openCard(row);
                        }}
                      >
                        <td
                          className="checkbox-cell"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            aria-label={"Select " + row.name}
                            checked={selected.has(row.key)}
                            onChange={(event) => {
                              const next = new Set(selected);
                              if (event.target.checked) next.add(row.key);
                              else next.delete(row.key);
                              setSelected(next);
                            }}
                          />
                        </td>
                        {visible.map((column) => (
                          <td
                            key={column.key}
                            className={column.kind === "text" ? "" : "numeric"}
                          >
                            {column.key === "name" ? (
                              <div className="card-name">
                                <strong>{row.name}</strong>
                                <span>
                                  {row.number ? row.number + " · " : ""}
                                  {row.language || "Language not specified"}
                                </span>
                              </div>
                            ) : (
                              <span
                                className={
                                  row[column.key] === null ? "unavailable" : ""
                                }
                              >
                                {column.key.startsWith("units") && row.lowerBound &&
                                row[column.key] !== null
                                  ? "≥"
                                  : ""}
                                {formatValue(row[column.key], column.kind)}
                              </span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!result.rows.length && (
                  <div className="no-results">
                    <Search size={24} />
                    <h3>No cards match this view</h3>
                    <p>Adjust your search or filters to see more cards.</p>
                    <button
                      className="button"
                      onClick={() => chooseView("all")}
                    >
                      Reset filters
                    </button>
                  </div>
                )}
              </div>
              <div className="table-footer">
                <div>
                  <strong>{result.matches.toLocaleString()}</strong> matching
                  rows
                  {loading && <LoaderCircle size={15} className="spin" />}
                </div>
                <div className="pagination">
                  <label>
                    Rows
                    <select
                      aria-label="Rows per page"
                      value={pageSize}
                      onChange={(event) => {
                        setPageSize(Number(event.target.value));
                        setPage(1);
                      }}
                    >
                      <option>25</option>
                      <option>50</option>
                      <option>100</option>
                    </select>
                  </label>
                  <span>
                    {page} / {Math.max(1, Math.ceil(result.matches / pageSize))}
                  </span>
                  <button
                    className="button small-button"
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                  >
                    Previous
                  </button>
                  <button
                    className="button small-button"
                    disabled={page * pageSize >= result.matches}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div
              className="empty-state"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const dropped = event.dataTransfer.files[0];
                if (dropped) void readFile(dropped, "upload");
              }}
            >
              <div className="empty-symbol">
                <FileSpreadsheet size={30} strokeWidth={1.5} />
              </div>
              <h2>Start with your inventory</h2>
              <p>
                Upload a SortSwift or TCGplayer CSV.
                <br />
                Your original data stays intact, and your inventory is saved for
                your next visit.
              </p>
              <button
                className="button primary"
                disabled={fileBusy || !meta}
                onClick={() => openFile("upload")}
              >
                {fileBusy ? (
                  <LoaderCircle size={17} className="spin" />
                ) : (
                  <Upload size={17} />
                )}
                Upload CSV
              </button>
              <span className="small muted">or drop a CSV file here</span>
              <div className="empty-note">
                <Check size={15} />
                <span>Importing a CSV uses no API credits.</span>
              </div>
            </div>
          )}
        </section>
        <footer className="workspace-footer">
          <span>
            <Clock3 size={14} />
            Sales history updated {dateLabel(result.lastRefreshed)}
          </span>
          <span>
            N/A means no reported quantity ·{" "}
            <a
              href="https://api.sh/docs/tcgplayer-price-history"
              target="_blank"
              rel="noreferrer"
            >
              API.SH documentation <ExternalLink size={12} />
            </a>
          </span>
        </footer>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(event) => {
            const picked = event.target.files?.[0];
            if (picked) void readFile(picked, importMode.current);
          }}
        />
      </main>
      {file && (
        <Modal
          error={error}
          title={
            file.mode === "replace"
              ? "Replace inventory"
              : file.mode === "update"
                ? "Update inventory"
                : "Import inventory"
          }
          onClose={cancelUpload}
          wide
        >
          <div className="modal-body">
            <div className="file-summary">
              <FileSpreadsheet size={23} />
              <div>
                <strong>{file.name}</strong>
                <p>
                  {file.count.toLocaleString()} rows · {file.headers.length}{" "}
                  columns
                </p>
              </div>
            </div>
            <p className="muted">
              {file.mode === "update"
                ? "Matching cards will be updated and new cards added. Cards absent from this CSV stay in inventory."
                : "The complete file is validated before your saved inventory changes."}{" "}
              Cached market data is kept separately.
            </p>
            <label>
              Which column contains the TCGplayer Product IDs?
              <select value={file.mapping.productId} disabled={fileBusy} onChange={event => setFile({...file, mapping: {productId: event.target.value}})}>
                <option value="">Choose a column</option>
                {file.headers.map(header => <option key={header}>{header}</option>)}
              </select>
            </label>
            <p className="small muted">Use the Product ID from a TCGplayer product link, or the link itself. Keep SKU numbers in their original column. All rows and columns are preserved. Sales cover all variants of each product and are only requested when you select Pull Sales History.</p>
            {file.mode === "replace" && (
              <label className="check-label danger-text">
                <input
                  type="checkbox"
                  checked={replaceConfirmed}
                  onChange={(event) =>
                    setReplaceConfirmed(event.target.checked)
                  }
                />
                Replace all current inventory with this validated file.
              </label>
            )}
            {fileBusy && (
              <div className="import-progress">
                <progress max={100} value={importProgress} />
                <p className="small muted">
                  {importProgress
                    ? importProgress +
                      "% uploaded. Your previous inventory is available until import completes."
                    : "Validating all rows…"}
                </p>
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button className="button" onClick={cancelUpload}>
              {fileBusy ? "Cancel import" : "Cancel"}
            </button>
            <button
              className="button primary"
              disabled={
                fileBusy || !file.mapping.productId || (file.mode === "replace" && !replaceConfirmed)
              }
              onClick={() => void upload()}
            >
              {fileBusy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Check size={16} />
              )}
              Save inventory
            </button>
          </div>
        </Modal>
      )}
      {modal === "account" && <Modal title="API.SH account and usage" error={error} onClose={()=>setModal(null)} wide>
        <div className="modal-body account-details">
          {accountBusy?<p><LoaderCircle className="spin" size={18}/> Reading free account endpoints…</p>:accountReport?<>
            <div className="detail-metrics"><div><span>Free monthly credits remaining</span><strong>{accountReport.snapshot.freeRemaining??"Unknown"}</strong></div><div><span>Available for refresh</span><strong>{accountReport.snapshot.available??0}</strong></div><div><span>Monthly spend (all buckets, UTC)</span><strong>{accountReport.snapshot.monthlyUsed??"Unknown"}</strong></div><div><span>Account monthly spending limit</span><strong>{accountReport.snapshot.monthlyLimit??"Not reported"}</strong></div></div>
            <p>Free credits reset {accountReport.snapshot.resetAt?new Date(accountReport.snapshot.resetAt).toUTCString():"when reported by API.SH"}. Account status: {accountReport.snapshot.status}. Reserved for in-flight requests: {accountReport.snapshot.reserved??0}.</p>
            <p className="small muted">The app also enforces a 1,000-credit ceiling and never changes your provider limit. Purchased credit balances are excluded. Saved market data remains available after resets.</p>
            {accountReport.errors?.map((e:string)=><p key={e} className="danger-text">{e}</p>)}
            <details><summary>Daily usage and endpoint statistics · UTC</summary><pre>{JSON.stringify(accountReport.usage,null,2)}</pre></details>
            <details><summary>Provider request logs</summary><pre>{JSON.stringify(accountReport.logs,null,2)}</pre></details>
            <details><summary>Saved request IDs and free recovery</summary><p className="small muted">Recover a stored response free for 30 days. It does not make a new paid market lookup.</p>
              {accountReport.requests?.map((r:RecordValue)=><div className="request-row" key={r.id}><span>{dateLabel(r.created_at)} · {r.status} · {r.charged??"unknown"} credits<br/><code>{r.request_id??"Request ID not received"}</code><br/><span className="small muted">{r.path}</span></span><button className="button" disabled={saving||!r.request_id||Date.now()-r.created_at>=30*86400000} onClick={()=>{setSaving(true);void api("market/recover",{id:r.id}).then(()=>loadMetadata()).then(()=>setNotice("Stored response recovered. No credits used.")).catch(showError).finally(()=>setSaving(false));}}>Recover free</button></div>)}
              {!accountReport.requests?.length&&<p className="small muted">No market requests yet.</p>}
            </details>
          </>:<p className="muted">Set API_SH_API_KEY as a secret in the backend environment to read your account. Your existing 1,000-credit monthly limit will be preserved.</p>}
        </div><div className="modal-footer"><button className="button" onClick={()=>setModal(null)}>Close</button></div>
      </Modal>}
      {modal === "settings" && (
        <Modal
          error={error}
          title="Settings"
          onClose={() => setModal(null)}
          wide
        >
          <div className="modal-body settings-body">
            <section>
              <h3>Appearance</h3>
              <label>Theme<select value={settings.theme} onChange={e=>setSettings({...settings,theme:e.target.value as Preferences["theme"]})}><option value="dark">Black dark mode</option><option value="light">Light mode</option></select></label>
            </section>
            <section>
              <h3>API.SH connection</h3>
              <p className="small muted">{meta?.connected?"The backend API key is configured.":"Set API_SH_API_KEY as a secret in this site's backend environment to connect."} Your key stays on the server. Account checks are free. Importing inventory never requests paid data.</p>
              <p className="small muted">Only verified free monthly credits are available for refreshes. The existing 1,000-credit spending limit is never changed. Purchased credits and paid features are not enabled by this app.</p>
              <button className="button" onClick={()=>{setError("");setModal("account");}}>Account and usage</button>
            </section>
            <section>
              <h3>Refresh preferences</h3>
              <div className="settings-grid">
                <label>Maximum products per refresh<input type="number" min="1" max="1000" value={settings.maxProducts} onChange={e=>setSettings({...settings,maxProducts:Number(e.target.value)})}/></label>
                <label>Outdated after (hours)<input type="number" min="1" value={settings.staleHours} onChange={e=>setSettings({...settings,staleHours:Number(e.target.value)})}/></label>
              </div>
              <label className="check-label"><input type="checkbox" checked={settings.prioritizeUnanalyzed} onChange={e=>setSettings({...settings,prioritizeUnanalyzed:e.target.checked})}/>Analyze new products first</label>
              <p className="small muted">Every pull shows the required API credits first. Results are kept across monthly resets so you can continue analyzing a large inventory over time.</p>
            </section>
            <details className="data-notes"><summary>Data coverage</summary>
              <p className="small muted">Pulls retrieve the widest available sales history: up to one year of weekly quantity totals. Filter saved totals by their reported dates afterward. Missing or unanalyzed quantities remain N/A.</p>
              <p className="small muted">A TCGplayer SKU is different from a Product ID. Include a Product ID column in your CSV, or add the ID from the TCGplayer product URL in card details. The returned SKU must match before sales are assigned.</p>
              <a href="https://api.sh/docs/tcgplayer-price-history" target="_blank" rel="noreferrer">Provider documentation <ExternalLink size={12}/></a>
            </details>
          </div>
          <div className="modal-footer">
            <button
              className="button"
              onClick={() => {
                if (meta) setSettings(meta.settings);
                setModal(null);
              }}
            >
              Cancel
            </button>
            <button
              className="button primary"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  await updateSettings(settings);
                      setModal(null);
                  setNotice("Settings saved.");
                } catch (problem) {
                  showError(problem);
                } finally {
                  setSaving(false);
                }
              }}
            >
              Save settings
            </button>
          </div>
        </Modal>
      )}
      {modal === "columns" && (
        <Modal
          error={error}
          title="Table columns"
          onClose={() => setModal(null)}
        >
          <div className="modal-body">
            <p className="muted small">
              Drag the grip to swap columns. The top column appears farthest left in the table. Your choices save automatically for your next visit and CSV upload.
            </p>
            <div className="column-list">
              {[
                ...settings.visibleColumns,
                ...columns
                  .map((column) => column.key)
                  .filter((key) => !settings.visibleColumns.includes(key)),
              ].filter(key => columns.some(column => column.key === key)).map((key) => {
                const column = columns.find((item) => item.key === key)!;
                const shown = settings.visibleColumns.includes(key);
                return (
                  <div
                    key={key}
                    data-column-key={key}
                    className={"column-option" + (shown ? " visible" : "") + (dragColumn === key ? " dragging" : "") + (dropColumn === key && dragColumn !== key ? " drop-target" : "")}
                  >
                    <button
                      className="column-grip"
                      aria-label={"Drag to reorder " + column.label}
                      title="Drag to swap columns. Keyboard: use the up and down arrow keys."
                      disabled={!shown}
                      onPointerDown={event => {
                        if (!shown) return;
                        event.preventDefault();
                        event.currentTarget.setPointerCapture(event.pointerId);
                        touchDrag.current = key;setDragColumn(key);setDropColumn(key);
                      }}
                      onPointerMove={event => {
                        if (!touchDrag.current) return;
                        const target = columnAt(event.clientX, event.clientY);
                        setDropColumn(target && visible.some(column => column.key === target) ? target : null);
                        const list = event.currentTarget.closest(".column-list"), bounds = list?.getBoundingClientRect();
                        if (bounds) list?.scrollBy(0, event.clientY < bounds.top + 32 ? -12 : event.clientY > bounds.bottom - 32 ? 12 : 0);
                      }}
                      onPointerUp={event => {
                        if (!touchDrag.current) return;
                        const target = columnAt(event.clientX, event.clientY);
                        if (target) swapColumns(touchDrag.current, target);
                        finishColumnDrag();
                        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                      }}
                      onPointerCancel={finishColumnDrag}
                      onKeyDown={event => {
                        if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
                        event.preventDefault();
                        const index = visible.findIndex(column => column.key === key), target = visible[index + (event.key === "ArrowUp" ? -1 : 1)];
                        if (target) swapColumns(key, target.key);
                      }}
                    ><GripVertical size={17} /></button>
                    <label>
                      <input
                        type="checkbox"
                        checked={shown}
                        disabled={shown && visible.length === 1}
                        onChange={(event) =>
                          changeColumns(event.target.checked
                              ? [...settings.visibleColumns, key]
                              : settings.visibleColumns.filter(
                                  (item) => item !== key,
                                ))
                        }
                      />
                      <span>{column.label}</span>
                    </label>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="modal-footer">
            <button
              className="button"
              onClick={() =>
                changeColumns([...(meta?.headers ?? []).map(csvColumnKey), ...defaults.visibleColumns])
              }
            >
              Reset columns
            </button>
            <button
              className="button primary"
              disabled={saving || !settings.visibleColumns.length}
              onClick={() => {
                setSaving(true);
                void columnSaveQueue.current
                  .then(() => setModal(null))
                  .catch(showError)
                  .finally(() => setSaving(false));
              }}
            >
              Done
            </button>
          </div>
        </Modal>
      )}
      {modal === "refresh" && (
        <Modal
          error={error}
          title="Pull Sales History"
          onClose={() => setModal(null)}
        >
          <div className="modal-body">
            <p className="muted">
              Pull all sales-quantity history available from the provider (up to one year of weekly totals) for {scope === "selected" ? selected.size.toLocaleString() + " selected rows" : "your inventory"}.
              Filter the saved results however you like afterward.
            </p>
            <div className="estimate">
              {planBusy ? (
                <p>
                  <LoaderCircle size={17} className="spin" />
                  Checking your cached inventory…
                </p>
              ) : plan ? (
                <>
                  <span className="eyebrow">API CREDITS REQUIRED</span>
                  <strong>
                    {plan.minimumCredits === plan.maximumCredits
                      ? plan.maximumCredits.toLocaleString()
                      : plan.minimumCredits.toLocaleString() +
                        "–" +
                        plan.maximumCredits.toLocaleString()}{" "}
                    credits
                  </strong>
                  <p>
                    {plan.groups.toLocaleString()} unique Product IDs to update
                  </p>
                  <p className="small muted">{plan.note}</p>
                  {plan.accountError&&<p className="danger-text">{plan.accountError}</p>}
                  {plan.account&&<p className="small muted">{Number(plan.account.available??0).toLocaleString()} free credits available.</p>}
                  {!plan.groups&&!plan.deferredProducts&&!plan.unresolved&&!plan.accountError&&<p className="small muted">Your saved sales history is up to date. No credits are needed.</p>}
                  {!!plan.unresolved&&<p className="small muted">{plan.unresolved} SKU groups need a Product ID. Add it in card details or your CSV.</p>}
                </>
              ) : (
                <p className="muted">No estimate available.</p>
              )}
            </div>
            {!meta?.connected && (
              <p className="connection-note">
                Configure the backend API.SH key to request live market
                data. Your CSV can be used independently.
              </p>
            )}
          </div>
          <div className="modal-footer">
            <button className="button" onClick={() => setModal(null)}>
              Cancel
            </button>
            {!meta?.connected ? (
              <button
                className="button primary"
                onClick={() => setModal("settings")}
              >
                Connection settings
              </button>
            ) : (
              <button
                className="button primary"
                disabled={planBusy || !plan?.groups || activeRefresh}
                onClick={() => void runRefresh()}
              >
                <RefreshCw size={16} />
                Pull Sales History
              </button>
            )}
          </div>
        </Modal>
      )}
      {modal === "export" && (
        <Modal
          error={error}
          title="Export inventory"
          onClose={() => setModal(null)}
        >
          <div className="modal-body">
            <fieldset className="scope-options">
              {[
                ["all", "Entire inventory"],
                ["filtered", "Filtered results"],
                ["selected", "Selected cards (" + selected.size + ")"],
              ].map(([value, label]) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="export-scope"
                    checked={exportScope === value}
                    disabled={value === "selected" && !selected.size}
                    onChange={() => setExportScope(value)}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
            <label>
              CSV format
              <select
                value={exportAnalysis ? "analysis" : "original"}
                onChange={(event) =>
                  setExportAnalysis(event.target.value === "analysis")
                }
              >
                <option value="original">Original CSV columns</option>
                <option value="analysis">
                  Original CSV with sales counts appended
                </option>
              </select>
            </label>
            <p className="muted small">
              {exportAnalysis
                ? "Analysis exports include the available retrieved values. Missing values are blank."
                : "Your original column names and values are preserved. Sales counts do not overwrite your CSV."}
            </p>
          </div>
          <div className="modal-footer">
            <button className="button" onClick={() => setModal(null)}>
              Cancel
            </button>
            <button
              className="button primary"
              disabled={saving}
              onClick={() => void exportFile()}
            >
              <Download size={16} />
              Download CSV
            </button>
          </div>
        </Modal>
      )}
      {modal === "preset" && (
        <Modal
          error={error}
          title="Save this view"
          onClose={() => setModal(null)}
        >
          <div className="modal-body">
            <label>
              View name
              <input
                value={saveName}
                autoFocus
                placeholder="For example, high-value holos"
                onChange={(event) => setSaveName(event.target.value)}
              />
            </label>
            <p className="muted small">
              Saves the current filters and sort order.
            </p>
            {settings.presets.length > 0 && (
              <div className="saved-views">
                <h3>Saved views</h3>
                {settings.presets.map((preset, index) => (
                  <div key={index}>
                    <span>{preset.name}</span>
                    <button
                      className="text-button danger-text"
                      onClick={() =>
                        void updateSettings({
                          ...settings,
                          presets: settings.presets.filter(
                            (_, i) => i !== index,
                          ),
                        }).catch(showError)
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button className="button" onClick={() => setModal(null)}>
              Cancel
            </button>
            <button
              className="button primary"
              disabled={!saveName.trim() || saving}
              onClick={() => {
                setSaving(true);
                void updateSettings({
                  ...settings,
                  presets: [
                    ...settings.presets.filter(
                      (item) => item.name !== saveName.trim(),
                    ),
                    { name: saveName.trim(), filters, sort, direction },
                  ],
                })
                  .then(() => {
                    setModal(null);
                    setNotice("View saved.");
                  })
                  .catch(showError)
                  .finally(() => setSaving(false));
              }}
            >
              Save view
            </button>
          </div>
        </Modal>
      )}
      {card && (
        <Modal
          error={error}
          title={card.card?.name ?? "Card details"}
          onClose={() => setCard(null)}
          wide
        >
          <div className="modal-body card-detail">
            {cardLoading ? (
              <div className="detail-loading">
                <LoaderCircle size={22} className="spin" />
                Loading card details…
              </div>
            ) : (
              <>
                <div className="detail-header">
                  {card.detail?.product?.imageUrl && (
                    <img
                      src={card.detail.product.imageUrl}
                      alt={card.card.name}
                      referrerPolicy="no-referrer"
                    />
                  )}
                  <div>
                    <p>
                      {card.card.set}
                      {card.card.number ? " · " + card.card.number : ""}
                    </p>
                    <p className="muted">
                      {card.card.condition || "Condition not provided"} ·{" "}
                      {card.card.printing || "Printing not provided"} ·{" "}
                      {card.card.language || "Language not provided"}
                    </p>
                    <p className="small muted">
                      TCGplayer SKU {card.card.skuId || "N/A"} · Product{" "}
                      {card.detail?.product?.productId ||
                        card.card.productId ||
                        "N/A"}{" "}
                    </p>
                    <p className="small muted">
                      Sales history updated {dateLabel(card.fetchedAt)}
                    </p>
                  </div>
                </div>
                {!card.card.productId && card.card.skuId && <details>
                  <summary>Add or correct Product ID</summary>
                  <p className="small muted">Use the number after /product/ in this card's TCGplayer URL. This saves a mapping without spending credits or changing your original CSV. The history response must contain the matching SKU.</p>
                  <div className="actions"><input aria-label="TCGplayer Product ID" inputMode="numeric" placeholder="Product ID" value={productDraft} onChange={e=>setProductDraft(e.target.value)}/><button className="button" disabled={!/^\d+$/.test(productDraft)||activeRefresh} onClick={()=>void api("market/product",{key:card.card.key,productId:productDraft}).then(()=>{setProductDraft("");setCard(null);return loadMetadata();}).then(()=>setNotice("Product ID saved. Refresh market data to verify the SKU.")).catch(showError)}>Save Product ID</button></div>
                </details>}
                {card.detail && <>
                  <h3>Units sold</h3>
                  <Suspense fallback={<p className="muted">Loading chart…</p>}><HistoryChart history={(card.detail.history ?? []).filter((point: RecordValue) => (!filters.dateFrom || point.date >= Date.parse(filters.dateFrom)) && (!filters.dateTo || point.date < Date.parse(filters.dateTo) + 86400000))}/></Suspense>
                  <p className="small muted">Weekly totals are selected by their reported date. Exact daily counts are not available.</p>
                </>}
                <div className="detail-metrics">
                  {marketColumns
                    .map((column) => (
                      <div key={column.key}>
                        <span title={column.note}>{column.label}</span>
                        <strong>
                          {column.key.startsWith("units") && card.market?.lowerBound &&
                          card.market?.[column.key] !== null &&
                          card.market?.[column.key] !== undefined
                            ? "≥"
                            : ""}
                          {formatValue(
                            selectedCardRow ? selectedCardRow[column.key] : card.market?.[column.key],
                            column.kind,
                          )}
                        </strong>
                      </div>
                    ))}
                </div>
                {card.detail?.notes?.map((note: string, index: number) => (
                  <p className="source-note" key={index}>
                    {note}
                  </p>
                ))}
                <details>
                  <summary>Original CSV values</summary>
                  <p className="small muted">
                    Showing up to 20 original rows for this card. Exports
                    preserve every row.
                  </p>
                  {card.originals?.map(
                    (original: RecordValue, index: number) => (
                      <dl key={index} className="original-values">
                        {Object.entries(original).map(([key, value]) => (
                          <div key={key}>
                            <dt>{key}</dt>
                            <dd>{String(value)}</dd>
                          </div>
                        ))}
                      </dl>
                    ),
                  )}
                </details>
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
