import { columns, csvColumnKey, inventoryColumns, type Filters, type Preferences } from "./domain";
import { csvCell } from "./csv";

export type SyncCard = {
  key: string; rowNo: number; raw: string; info: string; quantity: number;
  marketProduct: string | null; mappedProduct: string | null;
  data: string | null; detail: string | null; fetchedAt: number | null;
  originals?: {rowNo:number;raw:string}[];
};
export type SyncMetadata = {
  version: string; sequence: number; previousVersion: string; uploaded: number;
  headers: string[]; settings: Preferences; filename: string | null;
  importedAt: number | null; updatedAt: number | null; connected: boolean;
  serverManagedKey: boolean; usage: Record<string, any>; importing: string | null;
  refresh: Record<string, any> | null;
};
export type InventorySnapshot = {meta: SyncMetadata; cards: SyncCard[]};
export type SyncEvent = Pick<SyncCard,"marketProduct"|"mappedProduct"|"data"|"detail"|"fetchedAt"> & {
  seq: number; kind: "market"|"sku"; subject: string;
};
type Item = Record<string, any>;
type Input = {filters?: Filters; sort?: string; direction?: string; selected?: string[]; page?: number; pageSize?: number};

export function inventoryIdentity(card: SyncCard) {
  const info = JSON.parse(card.info);
  const normalizeId = (id: unknown) => String(id ?? "").replace(/^0+/,"") || "0";
  return info.productId ? "product:"+normalizeId(info.productId) : "sku:"+normalizeId(info.skuId);
}

export function indexInventory(cards: SyncCard[]) {
  return cards.map(record => {
    const info = JSON.parse(record.info), raw = JSON.parse(record.raw);
    const market = record.data ? JSON.parse(record.data) : {};
    const detail = record.detail ? JSON.parse(record.detail) : {};
    const row: Item = {
      ...info,...market,key:record.key,rowNo:record.rowNo,quantity:record.quantity,fetchedAt:record.fetchedAt,
      productId:info.productId || record.marketProduct || record.mappedProduct || null,
      analyzed:market.analyzed ?? market.available ?? 0,
    };
    for (const [key,value] of Object.entries(raw)) row[csvColumnKey(key)] = value;
    return {row,raw,info,detail,market,originals:record.originals};
  });
}
type Entry = ReturnType<typeof indexInventory>[number];
const fields = ["set","condition","printing","language","rarity"];
const numericFields = new Set(columns.filter(column=>["number","money","percent","score"].includes(column.kind)).map(column=>column.key));
const asciiLower = (value: string) => value.replace(/[A-Z]/g,c=>c.toLowerCase());
const ascending = (a: string|number,b: string|number) =>
  typeof a === typeof b ? a < b ? -1 : a > b ? 1 : 0 : typeof a === "number" ? -1 : 1;

export function describeInventory(entries: Entry[]) {
  const products = new Set<string>(), analyzed = new Set<string>(), missing = new Set<string>();
  const facets = Object.fromEntries(fields.map(field=>[field,new Set<string>()]));
  let totalCards = 0, historyFrom: number|null = null, historyTo: number|null = null;
  for (const {row,market} of entries) {
    totalCards += row.quantity;
    if (row.productId) {
      products.add(String(row.productId));
      if (row.analyzed) analyzed.add(String(row.productId));
    } else missing.add(row.skuId || row.key);
    if (market.historyFrom != null) historyFrom = Math.min(historyFrom ?? Infinity,market.historyFrom);
    if (market.historyTo != null) historyTo = Math.max(historyTo ?? -Infinity,market.historyTo);
    for (const field of fields) if (row[field]) facets[field].add(row[field]);
  }
  return {
    totals:{uniqueCards:entries.length,totalCards,historyFrom,historyTo,uniqueProducts:products.size,
      analyzedProducts:analyzed.size,unanalyzedProducts:products.size-analyzed.size,unresolvedProducts:missing.size},
    facets:Object.fromEntries(fields.map(field=>[field,[...facets[field]].sort(ascending)])),
  };
}

function reportedUnits(history: Item[], from: number|null, to: number|null) {
  const visible = history.filter(point => (from === null || point.date >= from) && (to === null || point.date < to + 86400000));
  return visible.length && visible.every(point=>point.units != null && point.units >= 0)
    ? visible.reduce((sum,point)=>sum+Number(point.units),0) : null;
}

function selectRows(entries: Entry[], input: Input, staleHours: number) {
  const f = input.filters;
  const from = f?.dateFrom ? Date.parse(f.dateFrom) : null, to = f?.dateTo ? Date.parse(f.dateTo) : null;
  if ((from !== null && !Number.isFinite(from)) || (to !== null && !Number.isFinite(to)) || (from !== null && to !== null && from > to))
    throw new Error("Choose a valid sales date range with the start before the end.");
  const selected = input.selected?.length ? new Set(input.selected) : null;
  const search = asciiLower(f?.search.trim() ?? ""), freshAfter = Date.now()-staleHours*3600000;
  const result: {row: Item; raw: Item; originals: SyncCard["originals"]}[] = [];
  for (const entry of entries) {
    const {raw,detail,market} = entry;
    let {row} = entry;
    if (selected && !selected.has(row.key)) continue;
    if (search && ![row.name,row.number,row.set,row.productId,row.skuId,...Object.values(raw)].some(value=>asciiLower(String(value ?? "")).includes(search))) continue;
    if (fields.some(field=>f?.categories[field]?.length && !f.categories[field].includes(row[field]))) continue;
    if (f?.freshness === "analyzed" && !row.analyzed ||
        f?.freshness === "unanalyzed" && row.analyzed ||
        f?.freshness === "missing" && entry.market.available !== false && entry.market.available !== 0 && row.fetchedAt != null ||
        f?.freshness === "fresh" && (row.fetchedAt == null || row.fetchedAt < freshAfter || !!market.partial) ||
        f?.freshness === "outdated" && !(row.fetchedAt != null && row.fetchedAt < freshAfter || market.partial)) continue;
    const history: Item[] = detail.history ?? [];
    const unitsSold = from !== null || to !== null ? reportedUnits(history,from,to) : row.unitsSold ?? reportedUnits(history,null,null);
    row = {...row,unitsSold,historyFrom:row.historyFrom ?? history[0]?.date ?? null,historyTo:row.historyTo ?? history.at(-1)?.date ?? null};
    if (f?.numeric.some(filter => numericFields.has(filter.field) && (
      filter.min !== "" && Number.isFinite(Number(filter.min)) && (row[filter.field] == null || row[filter.field] < Number(filter.min)) ||
      filter.max !== "" && Number.isFinite(Number(filter.max)) && (row[filter.field] == null || row[filter.field] > Number(filter.max))
    ))) continue;
    result.push({row,raw,originals:entry.originals});
  }
  const key = input.sort ?? "rowNo", direction = input.direction === "asc" ? 1 : -1;
  result.sort((a,b) => {
    const left = a.row[key], right = b.row[key];
    if (left == null || right == null) return Number(left == null)-Number(right == null) || ascending(a.row.key,b.row.key);
    return direction*ascending(left,right) || ascending(a.row.key,b.row.key);
  });
  return f?.limit === 50 || f?.limit === 100 ? result.slice(0,f.limit) : result;
}

export function queryLocalInventory(entries: Entry[], input: Input, staleHours: number) {
  const rows = selectRows(entries,input,staleHours), page = input.page ?? 1, pageSize = input.pageSize ?? 50;
  return {
    rows: rows.slice((page-1)*pageSize,page*pageSize).map(entry=>entry.row),
    page, pageSize, matches:rows.length, units:rows.reduce((sum,{row})=>sum+row.quantity,0),
    lastRefreshed:rows.reduce<number|null>((max,{row})=>row.fetchedAt == null ? max : Math.max(max??0,row.fetchedAt),null),
  };
}

export function localExport(entries: Entry[], input: Input, headers: string[], staleHours: number, analysis: boolean) {
  const rows = selectRows(entries,input,staleHours);
  const fields = inventoryColumns(headers);
  const labels = analysis ? fields.map(column=>column.label) : headers;
  const lines = analysis ? rows.map(({row})=>fields.map(column=>csvCell(row[column.key])).join(",")) :
    rows.flatMap(({row,raw,originals})=>[
      {rowNo:Number(row.rowNo),raw},
      ...(originals ?? []).map(item=>({rowNo:item.rowNo,raw:JSON.parse(item.raw)})),
    ]).sort((a,b)=>a.rowNo-b.rowNo).map(({raw})=>headers.map(header=>csvCell(raw[header])).join(","));
  return new Blob(["\uFEFF",labels.map(csvCell).join(","),"\r\n",lines.join("\r\n"),lines.length ? "\r\n" : ""],{type:"text/csv;charset=utf-8"});
}
