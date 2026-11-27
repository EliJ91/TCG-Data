export type CardInfo = {
  key: string;
  skuId: string;
  productId: string;
  name: string;
  number: string;
  set: string;
  rarity: string;
  condition: string;
  printing: string;
  language: string;
  quantity: number;
  quantityColumn?: string;
};
export type ImportRow = { info: CardInfo; raw: Record<string, string> };
export type NumericFilter = { field: string; min: string; max: string };
export type CategoryValue = string | number;
export function isTagsColumn(key: string) {
  return key.startsWith("csv:") && key.slice(4).trim().toLowerCase() === "tags";
}
export function isBlankCategory(value: unknown) {
  return value == null || typeof value === "string" && value.trim() === "";
}
export function hasDisplayValue(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value);
  return !isBlankCategory(value) && (typeof value !== "string" || value.trim().toUpperCase() !== "N/A");
}
export function isNumericFilterColumn(key: string) {
  if (key === "unitsSold" || key === "avgDailySold" || key === "quantity") return true;
  if (!key.startsWith("csv:")) return false;
  const header = normalizeLabel(key.slice(4));
  return header.includes("price") || header.includes("quantity") || header === "qty" || header === "stock" || header === "unitssold";
}
export function numericFilterValue(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.replace(/[$,]/g, "").trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}
export const legacyCategoryColumns = ["set", "condition", "printing", "language", "rarity"] as const;
export function isCategoryValue(value: unknown): value is CategoryValue {
  return typeof value === "string" ? value.trim().length > 0 : typeof value === "number" && Number.isFinite(value);
}
export type Filters = {
  search: string;
  categories: Record<string, CategoryValue[]>;
  numeric: NumericFilter[];
  freshness: string;
  dateField: string;
  dateFrom: string;
  dateTo: string;
  limit: number;
};
export type Preferences = {
  currentView: ViewPreferences | null;
  productIdColumn: string | null;
  staleHours: number;
  autoMinutes: number;
  historyRange: "month" | "quarter" | "semi-annual" | "annual";
  includePricing: boolean;
  includeListings: boolean;
  prioritizeUnanalyzed: boolean;
  maxProducts: number;
  theme: "light" | "dark";
  visibleColumns: string[];
  columnSelectionVersion: number;
  salesViewVersion: number;
  knownCsvColumns: string[];
  presets: {
    name: string;
    filters: Filters;
    sort: string;
    direction: string;
  }[];
};
export const defaultColumns = ["unitsSold", "scope", "historyFrom", "historyTo"];
export const defaults: Preferences = {
  currentView: null,
  productIdColumn: null,
  staleHours: 24,
  autoMinutes: 0,
  historyRange: "annual",
  includePricing: false,
  includeListings: false,
  prioritizeUnanalyzed: true,
  maxProducts: 100,
  theme: "dark",
  visibleColumns: defaultColumns,
  columnSelectionVersion: 0,
  salesViewVersion: 1,
  knownCsvColumns: [],
  presets: [],
};
export const emptyFilters: Filters = {
  search: "",
  categories: {},
  numeric: [],
  freshness: "all",
  dateField: "salesDate",
  dateFrom: "",
  dateTo: "",
  limit: 0,
};
export type ViewPreferences = {
  filters: Filters;
  sort: string;
  direction: "asc" | "desc";
  page: number;
  pageSize: number;
  view: string;
  advanced: boolean;
  exportScope: "all" | "filtered";
  exportAnalysis: boolean;
};
export function normalizeView(value: Partial<ViewPreferences> = {}): ViewPreferences {
  return {
    filters: normalizeFilters(value.filters),
    sort: typeof value.sort === "string" ? value.sort : "rowNo",
    direction: value.direction === "desc" ? "desc" : "asc",
    page: Number.isSafeInteger(value.page) && value.page! > 0 ? value.page! : 1,
    pageSize: [25,50,100].includes(value.pageSize!) ? value.pageSize! : 50,
    view: typeof value.view === "string" ? value.view : "all",
    advanced: value.advanced === true,
    exportScope: value.exportScope === "all" ? "all" : "filtered",
    exportAnalysis: value.exportAnalysis === true,
  };
}
export type Column = {
  key: string;
  label: string;
  kind: "text" | "number" | "decimal" | "date" | "salesDate";
  note?: string;
};
export const columns: Column[] = [
  { key: "name", label: "Card", kind: "text" },
  { key: "number", label: "Number", kind: "text" },
  { key: "set", label: "Set", kind: "text" },
  { key: "productId", label: "Product ID", kind: "text" },
  { key: "skuId", label: "TCGplayer SKU", kind: "text" },
  { key: "rarity", label: "Rarity", kind: "text" },
  { key: "condition", label: "Condition", kind: "text" },
  { key: "printing", label: "Printing", kind: "text" },
  { key: "language", label: "Language", kind: "text" },
  { key: "quantity", label: "Owned", kind: "number" },
  {key: "unitsSold", label: "Units sold", kind: "number", note: "Reported quantities in the selected sales dates. Weekly totals are not split into individual days."},
  {key: "avgDailySold", label: "Avg. Daily Sold", kind: "decimal", note: "Units sold divided by the number of calendar days, including both dates. Unset dates use this product’s saved history dates."},
  {key: "scope", label: "Sales coverage", kind: "text"},
  {key: "historyFrom", label: "History starts", kind: "salesDate"},
  {key: "historyTo", label: "History ends", kind: "salesDate"},
  {key: "fetchedAt", label: "Sales history updated", kind: "date"},
];
export const csvColumnKey = (header: string) => "csv:" + header;
const inventoryKeys = new Set(["name", "number", "set", "productId", "skuId", "rarity", "condition", "printing", "language", "quantity"]);
export const marketColumns = columns.filter(column => !inventoryKeys.has(column.key));
export function inventoryColumns(headers: string[]): Column[] {
  return [
    ...headers.map(header => ({key: csvColumnKey(header), label: header, kind: "text" as const})),
    ...marketColumns.map(column => headers.includes(column.label) ? {...column, label: "Sales · " + column.label} : column),
  ];
}
export function inventoryPreferences(p: Preferences, headers: string[]): Preferences {
  const rawKeys = headers.map(csvColumnKey);
  if (p.columnSelectionVersion !== 1)
    return {...p, columnSelectionVersion: 1, knownCsvColumns: rawKeys, visibleColumns: [...rawKeys, ...defaultColumns]};
  const added = rawKeys.filter(key => !p.knownCsvColumns.includes(key));
  const visibleColumns = [...p.visibleColumns];
  const marketIndex = visibleColumns.findIndex(key => !key.startsWith("csv:"));
  visibleColumns.splice(marketIndex < 0 ? visibleColumns.length : marketIndex, 0, ...added);
  if (!visibleColumns.some(key => inventoryColumns(headers).some(column => column.key === key)))
    visibleColumns.push(...rawKeys.slice(0, 1));
  return {...p, visibleColumns, knownCsvColumns: [...new Set([...p.knownCsvColumns, ...rawKeys])]};
}
export function normalizePreferences(value: Partial<Preferences>): Preferences {
  const result: Preferences = { ...defaults, ...Object.fromEntries(Object.entries(value).filter(([key]) => key in defaults)) };
  result.currentView = result.currentView && typeof result.currentView === "object" ? normalizeView(result.currentView) : null;
  result.productIdColumn = typeof result.productIdColumn === "string" ? result.productIdColumn.slice(0,1000) : null;
  for (const field of [
    "staleHours",
    "autoMinutes",
    "maxProducts",
  ] as const) {
    if (!Number.isFinite(result[field]) || result[field] < 0)
      result[field] = defaults[field];
  }
  result.maxProducts=Math.max(1,Math.min(1000,Math.round(result.maxProducts)));
  result.autoMinutes =
    result.autoMinutes === 0 ? 0 : Math.max(15, result.autoMinutes);
  result.staleHours = Math.max(1, result.staleHours);
  result.autoMinutes=0;
  result.historyRange="annual";
  result.includePricing=false;
  result.includeListings=false;
  result.prioritizeUnanalyzed=result.prioritizeUnanalyzed!==false;
  result.theme=result.theme==="light"?"light":"dark";
  result.visibleColumns = Array.isArray(result.visibleColumns)
    ? [
        ...new Set(
          result.visibleColumns.filter((key) =>
            typeof key === "string" && (key.startsWith("csv:") || columns.some((col) => col.key === key)),
          ),
        ),
      ]
    : [...defaultColumns];
  if (!result.visibleColumns.length) result.visibleColumns = [...defaultColumns];
  if (value.salesViewVersion !== 1 && !result.visibleColumns.includes("unitsSold")) result.visibleColumns.push("unitsSold");
  result.salesViewVersion = 1;
  result.columnSelectionVersion = result.columnSelectionVersion === 1 ? 1 : 0;
  result.knownCsvColumns = Array.isArray(result.knownCsvColumns) ? [...new Set(result.knownCsvColumns.filter(key => typeof key === "string" && key.startsWith("csv:")))] : [];
  result.presets = Array.isArray(result.presets)
    ? result.presets.slice(0, 30)
    : [];
  return result;
}
export function formatValue(value: unknown, kind: Column["kind"]) {
  if (
    value === null ||
    value === undefined ||
    (typeof value === "number" && !Number.isFinite(value))
  )
    return "N/A";
  if (kind === "date" || kind === "salesDate")
    return new Date(Number(value)).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: kind === "salesDate" ? "UTC" : undefined,
    });
  if (kind === "number") return Number(value).toLocaleString(undefined, {maximumFractionDigits: 0});
  if (kind === "decimal") return Number(value).toLocaleString(undefined, {maximumFractionDigits: 3});
  return String(value);
}
export const normalizeLabel = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]/g, "");

export function normalizeFilters(value: Partial<Filters> = {}): Filters {
  return {...emptyFilters, ...value, limit: 0, dateField: "salesDate", numeric: Array.isArray(value.numeric) ? value.numeric.filter(filter => isNumericFilterColumn(filter.field)) : [], categories: value.categories ?? {}};
}
