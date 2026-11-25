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
  originalPrice: number | null;
};
export type ImportRow = { info: CardInfo; raw: Record<string, string> };
export type NumericFilter = { field: string; min: string; max: string };
export type Filters = {
  search: string;
  categories: Record<string, string[]>;
  numeric: NumericFilter[];
  freshness: string;
  dateField: string;
  dateFrom: string;
  dateTo: string;
  limit: number;
};
export type Preferences = {
  feePercent: number;
  fixedFee: number;
  shipping: number;
  minimumPrice: number;
  velocityTarget: number;
  velocityWeight: number;
  demandWeight: number;
  profitWeight: number;
  staleHours: number;
  autoMinutes: number;
  historyRange: "month" | "quarter" | "semi-annual" | "annual";
  includePricing: boolean;
  includeListings: boolean;
  prioritizeUnanalyzed: boolean;
  maxProducts: number;
  theme: "light" | "dark";
  visibleColumns: string[];
  presets: {
    name: string;
    filters: Filters;
    sort: string;
    direction: string;
  }[];
};
export const defaultColumns = [
  "name",
  "set",
  "condition",
  "printing",
  "quantity",
  "marketPrice",
  "units30",
  "dailySales",
  "priority",
  "netProceeds",
];
export const defaults: Preferences = {
  feePercent: 13.25,
  fixedFee: 0.3,
  shipping: 0,
  minimumPrice: 0.25,
  velocityTarget: 5,
  velocityWeight: 50,
  demandWeight: 30,
  profitWeight: 20,
  staleHours: 24,
  autoMinutes: 0,
  historyRange: "month",
  includePricing: false,
  includeListings: false,
  prioritizeUnanalyzed: true,
  maxProducts: 100,
  theme: "dark",
  visibleColumns: defaultColumns,
  presets: [],
};
export const emptyFilters: Filters = {
  search: "",
  categories: {},
  numeric: [],
  freshness: "all",
  dateField: "lastSoldAt",
  dateFrom: "",
  dateTo: "",
  limit: 0,
};
export type Column = {
  key: string;
  label: string;
  kind: "text" | "money" | "number" | "percent" | "date" | "score";
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
  {
    key: "marketPrice",
    label: "Market price",
    kind: "money",
    note: "An exact SKU quote where available. Product quotes are identified in card details.",
  },
  { key: "listingLow", label: "Lowest listing", kind: "money" },
  { key: "listingMedian", label: "Median listing · sample", kind: "money" },
  { key: "listingHigh", label: "Highest listing · sample", kind: "money" },
  { key: "soldAverage", label: "Average sold · sample", kind: "money" },
  { key: "soldRecent", label: "Latest sold · sample", kind: "money" },
  { key: "change7", label: "Price change · 7d", kind: "percent" },
  { key: "change30", label: "Price change · 30d", kind: "percent" },
  { key: "change90", label: "Price change · 90d", kind: "percent" },
  ...[7, 14, 30, 60, 90].map((days) => ({
    key: "units" + days,
    label: "Units sold · " + days + "d",
    kind: "number" as const,
    note: "Exact completed UTC-day totals require daily data for every day. N/A means the requested period is not fully covered.",
  })),
  { key: "transactions30", label: "Transactions · 30d", kind: "number" },
  {
    key: "dailySales",
    label: "Units / day",
    kind: "number",
    note: "Average of reported completed daily buckets. Weekly data is never treated as daily sales.",
  },
  {
    key: "salesFrequency",
    label: "Sales frequency",
    kind: "number",
    note: "Transactions per completed UTC day when the full 30-day window is covered.",
  },
  { key: "unitsPerTransaction", label: "Units / transaction", kind: "number" },
  { key: "lastSoldAt", label: "Last reported sale", kind: "date" },
  { key: "daysSinceSale", label: "Days since sale", kind: "number" },
  { key: "salesTrend", label: "Sales trend", kind: "percent" },
  { key: "activeListings", label: "Total active listings", kind: "number" },
  { key: "totalSupply", label: "Total market stock", kind: "number" },
  { key: "competingSellers", label: "Total competing sellers", kind: "number" },
  { key: "listingCount", label: "Listings · sample", kind: "number" },
  { key: "sampleSupply", label: "Stock · sample", kind: "number" },
  { key: "sampleSellers", label: "Sellers · sample", kind: "number" },
  {
    key: "demandSupply",
    label: "Demand / supply",
    kind: "number",
    note: "Requires verified total supply. A listing sample is not total supply.",
  },
  { key: "daysSupply", label: "Days of market supply", kind: "number" },
  { key: "velocityScore", label: "Velocity", kind: "score" },
  {
    key: "demandScore",
    label: "Demand",
    kind: "score",
    note: "A configurable sales velocity and trend proxy.",
  },
  { key: "competitionScore", label: "Competition · sample", kind: "score" },
  { key: "priority", label: "Listing priority", kind: "score" },
  { key: "recommendedPrice", label: "Suggested price", kind: "money" },
  { key: "netProceeds", label: "Net / card", kind: "money" },
  { key: "inventoryValue", label: "Inventory value", kind: "money" },
  { key: "fetchedAt", label: "Market refreshed", kind: "date" },
];
export function normalizePreferences(value: Partial<Preferences>): Preferences {
  const result = { ...defaults, ...value };
  for (const field of [
    "feePercent",
    "fixedFee",
    "shipping",
    "minimumPrice",
    "velocityTarget",
    "velocityWeight",
    "demandWeight",
    "profitWeight",
    "staleHours",
    "autoMinutes",
    "maxProducts",
  ] as const) {
    if (!Number.isFinite(result[field]) || result[field] < 0)
      result[field] = defaults[field];
  }
  result.feePercent = Math.min(100, result.feePercent);
  result.velocityTarget = Math.max(0.01, result.velocityTarget);
  result.maxProducts=Math.max(1,Math.min(1000,Math.round(result.maxProducts)));
  result.autoMinutes =
    result.autoMinutes === 0 ? 0 : Math.max(15, result.autoMinutes);
  result.staleHours = Math.max(1, result.staleHours);
  result.autoMinutes=0;
  result.historyRange=["month","quarter","semi-annual","annual"].includes(result.historyRange)?result.historyRange:"month";
  result.includePricing=result.includePricing===true;
  result.includeListings=result.includeListings===true;
  result.prioritizeUnanalyzed=result.prioritizeUnanalyzed!==false;
  result.theme=result.theme==="light"?"light":"dark";
  result.visibleColumns = Array.isArray(result.visibleColumns)
    ? [
        ...new Set(
          result.visibleColumns.filter((key) =>
            columns.some((col) => col.key === key),
          ),
        ),
      ]
    : [...defaultColumns];
  if (!result.visibleColumns.length) result.visibleColumns = ["name"];
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
  if (kind === "date")
    return new Date(Number(value)).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  if (kind === "money")
    return Number(value).toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
    });
  if (kind === "percent")
    return (Number(value) > 0 ? "+" : "") + Number(value).toFixed(1) + "%";
  if (kind === "number" || kind === "score")
    return Number(value).toLocaleString(undefined, {
      maximumFractionDigits: kind === "score" ? 0 : 2,
    });
  return String(value);
}
export const normalizeLabel = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]/g, "");
