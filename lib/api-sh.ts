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
export function normalizeMarket(info: Json, body: Json, extras: Json = {}, now = Date.now()) {
  const candidates = (Array.isArray(body.series) ? body.series : []).filter((s: any) => s && typeof s === "object" && variantMatches(info, s));
  const sku = candidates.length === 1 ? candidates[0] : null;
  const granularity = body.range === "month" ? "daily" : "weekly";
  const history = (Array.isArray(sku?.points) ? sku.points : []).filter((p: any) => p && typeof p === "object").map((p: any) => ({ date: Date.parse(p.date), units: numberOrNull(p.quantity_sold), transactions: numberOrNull(p.transactions), market: numberOrNull(p.market_price), low: numberOrNull(p.low_sale_with_shipping) ?? numberOrNull(p.low_sale), high: numberOrNull(p.high_sale_with_shipping) ?? numberOrNull(p.high_sale) })).filter((p: any) => Number.isFinite(p.date)).sort((a: any,b: any) => a.date-b.date);
  const metrics: Json = { scope: sku ? "Exact SKU" : "Variant not matched", analyzed: true, available: !!sku, lowerBound: false, granularity, provider: "API.SH", marketPrice: null, listingLow: null, listingMedian: null, listingHigh: null, soldAverage: null, soldRecent: null, lastSoldAt: null, daysSinceSale: null, activeListings: null, totalSupply: null, competingSellers: null, listingCount: null, sampleSupply: null, sampleSellers: null, demandSupply: null, daysSupply: null, dailySales: null, salesFrequency: null, transactions30: null, unitsPerTransaction: null, salesTrend: null };
  const today = Math.floor(now / DAY) * DAY;
  // Exact completed UTC-day totals require every daily bucket. Never apportion weekly buckets.
  const window = (days: number, offset = 0) => {
    if (granularity !== "daily") return null;
    const rows = [];
    for (let i = days + offset; i > offset; i--) {
      const matches = history.filter((p: any) => p.date === today - i * DAY);
      if (matches.length !== 1 || matches[0].units === null || matches[0].units < 0) return null;
      rows.push(matches[0]);
    }
    return rows;
  };
  for (const days of [7,14,30,60,90]) { const rows=window(days); metrics["units"+days] = rows ? rows.reduce((s: number,p: any)=>s+p.units,0) : null; }
  const recent=window(30), previous=window(30,30);
  const dailyRows = granularity === "daily" ? history.filter((p: any)=>p.date >= today-30*DAY && p.date < today && p.units !== null && p.units >= 0) : [];
  const distinctDays = new Set(dailyRows.map((p: any)=>p.date));
  const coveredDays = distinctDays.size === dailyRows.length ? dailyRows.length : 0;
  metrics.dailySales = coveredDays ? dailyRows.reduce((s: number,p: any)=>s+p.units,0)/coveredDays : null;
  const transactions = recent?.every((p: any)=>p.transactions !== null && p.transactions >= 0) ? recent.reduce((s: number,p: any)=>s+p.transactions,0) : null;
  metrics.transactions30=transactions;
  metrics.salesFrequency=transactions === null ? null : transactions/30;
  metrics.unitsPerTransaction=transactions && metrics.units30 !== null ? metrics.units30/transactions : null;
  const previousUnits=previous?.reduce((s: number,p: any)=>s+p.units,0);
  metrics.salesTrend=previousUnits && metrics.units30 !== null ? (metrics.units30/previousUnits-1)*100 : null;
  metrics.marketPrice=[...history].reverse().find((p: any)=>p.market !== null)?.market ?? null;
  for(const days of [7,30,90]) { const p=history.find((p: any)=>p.date===today-days*DAY && p.market !== null); metrics["change"+days]=p?.market && metrics.marketPrice !== null ? (metrics.marketPrice/p.market-1)*100 : null; }
  const quote = Array.isArray(extras.product?.skus) ? extras.product.skus.filter((s: any)=>variantMatches(info,s)) : [];
  if(quote.length===1) { metrics.marketPrice=numberOrNull(quote[0].market_price) ?? metrics.marketPrice; metrics.listingLow=numberOrNull(quote[0].lowest_price); }
  const listings=(Array.isArray(extras.listings?.listings)?extras.listings.listings:[]).filter((r: any)=>sku && variantMatches({...info,skuId:String(sku.sku)},r));
  if(listings.length) {
    const prices=listings.map((r: any)=>numberOrNull(r.price)).filter((n: any)=>n!==null).sort((a: number,b: number)=>a-b);
    metrics.listingCount=listings.length;
    metrics.sampleSupply=listings.every((r: any)=>numberOrNull(r.quantity)!==null) ? listings.reduce((s: number,r: any)=>s+Number(r.quantity),0) : null;
    metrics.sampleSellers=new Set(listings.map((r: any)=>r.seller?.key).filter(Boolean)).size || null;
    metrics.listingMedian=prices.length ? (prices[Math.floor((prices.length-1)/2)]+prices[Math.floor(prices.length/2)])/2 : null;
    metrics.listingHigh=prices.at(-1) ?? null;
  }
  return {metrics,detail:{product:{...extras.product,productId:body.product_id,imageUrl:extras.product?.image},sku,history,granularity,range:body.range,coveredDays,listings,notes:[!sku?"No unique SKU matched this card. Sales remain N/A; this does not mean zero sales.":null,granularity==="weekly"?"This range contains weekly buckets. Exact daily rates and rolling day totals remain N/A.":"Exact totals cover complete UTC days and require a daily bucket for every day in the window. Missing days remain unknown. Units per day uses only reported completed daily buckets.","Listing and seller samples are not total marketplace supply."].filter(Boolean)}};
}
