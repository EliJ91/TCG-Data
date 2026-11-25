// API.SH's free monthly bucket is the only allowance this app may spend.
export const API_SH_BASE = "https://api.api.sh";
export const DAY = 86_400_000;
export const ranges = ["month", "quarter", "semi-annual", "annual"] as const;
export type HistoryRange = (typeof ranges)[number];
type Json = Record<string, any>;
export const numberOrNull = (v: any): number | null => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null;
export function accountSnapshot(body: Json, now = Date.now()) {
  const free = numberOrNull(body.credits?.free);
  const resetAt = Date.parse(body.credits?.free_resets_at ?? "");
  const monthlyUsed = numberOrNull(body.spend?.this_month);
  const monthlyLimit = numberOrNull(body.spend?.monthly_limit);
  const dailyUsed = numberOrNull(body.spend?.today);
  const dailyLimit = numberOrNull(body.spend?.daily_limit);
  const verified = !!body.account?.id && body.account.status === "active" && free !== null && free >= 0 && Number.isFinite(resetAt) && resetAt > now && monthlyUsed !== null && monthlyUsed >= 0 && body.spend?.period === "UTC" && (dailyLimit === null || dailyUsed !== null);
  const available = verified ? Math.max(0, Math.min(free!, 1000 - monthlyUsed!, monthlyLimit === null ? Infinity : monthlyLimit - monthlyUsed!, dailyLimit === null ? Infinity : dailyLimit - dailyUsed!)) : 0;
  return { accountId: String(body.account?.id ?? ""), status: body.account?.status ?? "unknown", freeRemaining: free, available, monthlyUsed, monthlyLimit, dailyUsed, dailyLimit, resetAt: Number.isFinite(resetAt) ? resetAt : null, period: "UTC", verified, updatedAt: now };
}
export function chargedCredits(headers: Headers, body: Json, fallback: number) {
  const header = numberOrNull(headers.get("x-credits-used"));
  const metadata = numberOrNull(body.credits_used);
  // A mismatch is accounted conservatively, including unsuccessful lookups.
  const values = [header, metadata].filter((v): v is number => v !== null && v >= 0);
  return { used: values.length ? Math.max(...values) : fallback, verified: values.length > 0, combinedRemaining: numberOrNull(headers.get("x-credits-remaining")), requestId: headers.get("x-request-id") };
}
const label = (v: any) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const condition = (v: any) => label(String(v ?? "").replace(/reverse\s*holofoil|holofoil|reverse\s*foil|etched\s*foil|foil/gi, "")).replace(/^nm$/, "nearmint").replace(/^lp$/, "lightlyplayed").replace(/^mp$/, "moderatelyplayed").replace(/^hp$/, "heavilyplayed").replace(/^dmg$/, "damaged");
const printing = (v: any) => label(v).replace(/^nonfoil$/, "normal").replace(/^foil$/, "holofoil").replace(/^reversefoil$/, "reverseholofoil");
const language = (v: any) => ({ en: "english", eng: "english", jp: "japanese", ja: "japanese", fr: "french", de: "german", es: "spanish", it: "italian", ko: "korean", pt: "portuguese" }[label(v)] ?? label(v));
export function variantMatches(info: Json, row: Json) {
  const finish = info.printing || String(info.condition ?? "").match(/reverse\s*holofoil|reverse\s*foil|holofoil|etched\s*foil|foil/i)?.[0];
  return (!info.skuId || String(row.sku) === String(info.skuId)) && (!info.condition || condition(info.condition) === condition(row.condition)) && (!finish || printing(finish) === printing(row.printing)) && (!info.language || language(info.language) === language(row.language));
}
export const SALES_FIELDS = ["product_id", "range", "series.sku", "series.condition", "series.printing", "series.language", "series.total_quantity_sold", "series.points.date", "series.points.quantity_sold"];
export const salesHistoryPath = (id: string) => "/tcgplayer/v1/price-history?id=" + id + "&range=annual&raw=0&fields=" + encodeURIComponent(SALES_FIELDS.join(","));
export function salesOnlyResponse(body: Json): Json {
  const result: Json = {};
  for (const key of ["product_id", "range", "cached", "fetched_at", "credits_used", "success", "error"]) if (key in body) result[key] = body[key];
  if (Array.isArray(body.series)) result.series = body.series.filter((row: any) => row && typeof row === "object").map((row: any) => ({
    sku: row.sku, condition: row.condition, printing: row.printing, language: row.language,
    total_quantity_sold: row.total_quantity_sold,
    points: (Array.isArray(row.points) ? row.points : []).filter((point: any) => point && typeof point === "object").map((point: any) => ({date: point.date, quantity_sold: point.quantity_sold})),
  }));
  return result;
}
const quantity = (value: any) => {const n = numberOrNull(value);return n !== null && n >= 0 ? n : null;};
export function normalizeMarket(info: Json, input: Json, _extras: Json = {}, _now = Date.now()) {
  const body = salesOnlyResponse(input);
  const candidates = (body.series ?? []).filter((row: Json) => variantMatches(info, row));
  const aggregate = !info.skuId && !info.condition && !info.printing && !info.language;
  const available = candidates.length > 0 && (aggregate || candidates.length === 1) && new Set(candidates.map((row: Json) => String(row.sku))).size === candidates.length;
  const sources: Json[][] = available ? candidates.map((row: Json) => row.points) : [];
  const dates = [...new Set<string>(sources.flatMap(points => points.map(point => point.date)))];
  const history = dates.map(date => {
    const buckets = sources.map(points => points.filter(point => point.date === date));
    const complete = buckets.every(points => points.length === 1 && quantity(points[0].quantity_sold) !== null);
    return {date: Date.parse(date), units: complete ? buckets.reduce((sum, points) => sum + Number(points[0].quantity_sold), 0) : null};
  }).filter(point => Number.isFinite(point.date)).sort((a,b) => a.date-b.date);
  const totals = candidates.map((row: Json) => quantity(row.total_quantity_sold));
  const total = available && totals.every((n: number | null) => n !== null) ? totals.reduce((sum: number,n: number) => sum+n,0)
    : history.length && history.every(point => point.units !== null) ? history.reduce((sum,point) => sum+point.units!,0) : null;
  const granularity = body.range === "month" ? "daily" : "weekly";
  const scope = available ? aggregate && candidates.length > 1 ? "Product · all SKUs" : "Exact SKU" : "Variant not matched";
  const metrics: Json = {scope, analyzed: true, available, granularity, historyRange: body.range, unitsSold: total, historyFrom: history[0]?.date ?? null, historyTo: history.at(-1)?.date ?? null};
  return {metrics, detail: {product: {productId: body.product_id}, history, granularity, range: body.range, notes: [
    aggregate && candidates.length > 1 ? "Quantities combine all conditions, printings, and languages for this product." : null,
    !available ? "No matching sales history was returned. Missing counts remain N/A." : null,
    granularity === "weekly" ? "Dates select the provider's reported weekly totals. Exact individual-day counts are not available." : "Dates select the provider's reported daily totals.",
  ].filter(Boolean)}};
}
export function mergeSalesHistory(previous: Json[], incoming: Json[]) {
  const points = new Map<number, {date: number; units: number | null}>();
  for (const point of [...previous, ...incoming]) if (Number.isFinite(point?.date)) points.set(point.date, {date: point.date, units: quantity(point.units)});
  return [...points.values()].sort((a,b) => a.date-b.date);
}
