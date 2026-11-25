import {
  apiKey,
  AppError,
  buildQuery,
  database,
  preferences,
  workspace,
  type QueryInput,
  type Workspace,
} from "./data";
import { normalizeLabel, type CardInfo, type Preferences } from "./domain";

type ObjectValue = Record<string, any>;
const object = (value: any): ObjectValue =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
const array = (value: any): ObjectValue[] =>
  Array.isArray(value) ? value : [];
const numeric = (value: any): number | null =>
  value !== null &&
  value !== undefined &&
  value !== "" &&
  Number.isFinite(Number(value))
    ? Number(value)
    : null;
const timestamp = (value: any): number | null => {
  const result = Date.parse(String(value ?? ""));
  return Number.isFinite(result) ? result : null;
};
const day = 86400000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const condition = (value: string) =>
  normalizeLabel(
    value
      .replace(
        /reverse\s*holofoil|holofoil|reverse\s*foil|etched\s*foil|foil/gi,
        "",
      )
      .trim(),
  )
    .replace(/^nm$/, "nearmint")
    .replace(/^lp$/, "lightlyplayed")
    .replace(/^mp$/, "moderatelyplayed")
    .replace(/^hp$/, "heavilyplayed")
    .replace(/^dmg$/, "damaged");
const printing = (value: string) =>
  normalizeLabel(value)
    .replace(/^nonfoil$/, "normal")
    .replace(/^foil$/, "holofoil")
    .replace(/^reversefoil$/, "reverseholofoil");
async function cache(owner: string, key: string) {
  return database()
    .prepare("SELECT data,fetched_at FROM api_cache WHERE id=? AND owner=?")
    .bind(owner + "|" + key, owner)
    .first<{ data: string; fetched_at: number }>();
}
async function storeCache(owner: string, key: string, data: any) {
  await database()
    .prepare(
      "INSERT INTO api_cache (id,owner,fetched_at,data) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET fetched_at=excluded.fetched_at,data=excluded.data",
    )
    .bind(owner + "|" + key, owner, Date.now(), JSON.stringify(data))
    .run();
}
async function activeRun(owner: string, id: string) {
  const run = await database()
    .prepare("SELECT * FROM refresh_runs WHERE owner=? AND id=?")
    .bind(owner, id)
    .first<ObjectValue>();
  if (!run || run.status !== "running")
    throw new AppError("Refresh cancelled or already finished.", 409);
  return run;
}
export async function provider(
  owner: string,
  runId: string,
  key: string,
  path: string,
  cost: number,
  useCache = false,
) {
  const existing = await cache(owner, path);
  if (useCache && existing && Date.now() - existing.fetched_at < 30 * day)
    return JSON.parse(existing.data);
  for (let attempt = 0; attempt < 3; attempt++) {
    await activeRun(owner, runId);
    await sleep(260);
    let response: Response;
    try {
      response = await fetch("https://api.tcgapis.com" + path, {
        headers: { "x-api-key": key, Accept: "application/json" },
        signal: AbortSignal.timeout(25000),
      });
    } catch (error) {
      if (attempt < 2) {
        await sleep((attempt + 1) * 1000);
        continue;
      }
      throw new AppError(
        "TCGAPIs did not respond. Your previous market data is preserved.",
        502,
      );
    }
    await database()
      .prepare(
        "UPDATE refresh_runs SET detail=json_set(detail,'$.requests',COALESCE(json_extract(detail,'$.requests'),0)+1) WHERE id=? AND owner=?",
      )
      .bind(runId, owner)
      .run();
    if (response.ok) {
      const body = (await response.json()) as ObjectValue;
      if (body.success === false)
        throw new AppError("TCGAPIs returned no data for this product.", 502);
      const creditCost = numeric(response.headers.get("X-Credits-Cost"));
      const callCost = numeric(response.headers.get("X-RateLimit-Cost"));
      const used = creditCost ?? callCost ?? cost;
      const remaining = numeric(response.headers.get("X-RateLimit-Remaining"));
      const usage = {
        unit:
          creditCost !== null
            ? "credits"
            : callCost !== null
              ? "calls"
              : "estimated credits",
        remaining,
        limit: numeric(response.headers.get("X-RateLimit-Limit")),
        window: response.headers.get("X-RateLimit-Window"),
        updatedAt: Date.now(),
      };
      await database().batch([
        database()
          .prepare("UPDATE workspaces SET usage=? WHERE owner=?")
          .bind(JSON.stringify(usage), owner),
        database()
          .prepare(
            "UPDATE refresh_runs SET spent=spent+? WHERE owner=? AND id=?",
          )
          .bind(used, owner, runId),
      ]);
      await storeCache(owner, path, body);
      return body;
    }
    await database()
      .prepare(
        "UPDATE refresh_runs SET detail=json_set(detail,'$.failedRequests',COALESCE(json_extract(detail,'$.failedRequests'),0)+1) WHERE id=? AND owner=?",
      )
      .bind(runId, owner)
      .run();
    const failure = object(await response.json().catch(() => ({})));
    if (failure.code === "INSUFFICIENT_ALLOWANCE")
      throw new AppError(
        "Your TCGAPIs allowance is exhausted. The refresh has stopped and cached data is preserved.",
        403,
      );
    if (response.status === 401 || response.status === 403)
      throw new AppError(
        "TCGAPIs rejected the key or the account has no remaining allowance. Check Settings and your provider account.",
        403,
      );
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      const retry = response.headers.get("Retry-After");
      const seconds =
        retry && Number.isFinite(Number(retry))
          ? Number(retry)
          : retry && Number.isFinite(Date.parse(retry))
            ? Math.max(1, (Date.parse(retry) - Date.now()) / 1000)
            : 5 * (attempt + 1);
      if (seconds > 30)
        throw new AppError(
          "The provider requested a longer wait. The refresh has stopped. Try again after " +
            Math.ceil(seconds) +
            " seconds.",
          429,
        );
      await sleep(Math.max(1, seconds) * 1000);
      continue;
    }
    throw new AppError(
      response.status === 429
        ? "The provider is rate-limiting requests. Try again later."
        : "TCGAPIs could not return this market data (HTTP " +
          response.status +
          ").",
      response.status === 429 ? 429 : 502,
    );
  }
  throw new AppError("TCGAPIs could not complete the request.", 502);
}
function skuRecord(body: ObjectValue, skuId: string) {
  const data = body.data;
  const candidates = [
    ...array(data),
    ...array(object(data).skus),
    object(object(data).sku),
    object(data),
  ];
  return (
    candidates.find(
      (row) =>
        String(row.skuId) === skuId && /^\d+$/.test(String(row.productId)),
    ) ?? null
  );
}
function inventoryPrinting(info: CardInfo) {
  if (info.printing) return info.printing;
  const match = info.condition.match(
    /reverse\s*holofoil|reverse\s*foil|holofoil|etched\s*foil|foil/i,
  );
  return match?.[0] ?? "";
}
function matchSku(info: CardInfo, product: ObjectValue) {
  const skus = array(product.skus);
  const candidates = skus.filter((sku) => {
    if (info.skuId && String(sku.skuId) !== info.skuId) return false;
    if (
      info.condition &&
      condition(info.condition) !==
        condition(String(sku.condName ?? sku.condAbbr ?? ""))
    )
      return false;
    const finish = inventoryPrinting(info);
    if (finish && printing(finish) !== printing(String(sku.printingName ?? "")))
      return false;
    if (
      info.language &&
      ![sku.languageName, sku.langAbbr].some(
        (value) =>
          normalizeLabel(String(value ?? "")) === normalizeLabel(info.language),
      )
    )
      return false;
    return true;
  });
  return candidates.length === 1 ? candidates[0] : null;
}
export function normalizeMarket(
  info: CardInfo,
  product: ObjectValue,
  payloads: Record<string, ObjectValue>,
  completeArchive: boolean,
) {
  const now = Date.now(),
    sku = matchSku(info, product),
    skuId = sku ? String(sku.skuId) : "";
  const quotes = array(object(payloads.sku?.data).skus);
  const quote = sku
    ? quotes.find((row) => String(row.skuId) === skuId)
    : undefined;
  const rows = sku
    ? array(payloads.archive?.data?.rows).filter(
        (row) => String(row.skuId) === skuId,
      )
    : [];
  const metrics: ObjectValue = {
    scope: sku ? "Exact SKU" : "Variant not matched",
    available: false,
    lowerBound: true,
    activeListings: null,
    totalSupply: null,
    competingSellers: null,
    demandSupply: null,
    daysSupply: null,
    soldAverage: null,
    soldRecent: null,
    lastSoldAt: null,
    daysSinceSale: null,
  };
  metrics.marketPrice = numeric(quote?.marketPrice);
  metrics.listingLow = numeric(quote?.lowPrice);
  const history = rows
    .map((row) => ({
      date: timestamp(row.bucketStartDate),
      units: numeric(row.quantitySold),
      transactions: numeric(row.transactionCount),
      market: numeric(row.marketPrice),
      low: numeric(row.lowSalePriceWithShipping) ?? numeric(row.lowSalePrice),
      high:
        numeric(row.highSalePriceWithShipping) ?? numeric(row.highSalePrice),
    }))
    .filter((row) => row.date !== null);
  const window = (days: number, offset = 0) =>
    history.filter(
      (row) =>
        row.date! >= now - (days + offset) * day &&
        row.date! + 3 * day <= now - offset * day,
    );
  for (const days of [7, 14, 30, 60, 90]) {
    const valid = window(days).filter((row) => row.units !== null);
    metrics["units" + days] = valid.length
      ? valid.reduce((sum, row) => sum + row.units!, 0)
      : null;
  }
  const recent = window(30),
    coveredDays =
      new Set(recent.filter((row) => row.units !== null).map((row) => row.date))
        .size * 3;
  const transactions = recent.filter((row) => row.transactions !== null);
  metrics.transactions30 = transactions.length
    ? transactions.reduce((sum, row) => sum + row.transactions!, 0)
    : null;
  const transactionDays = new Set(transactions.map((row) => row.date)).size * 3;
  metrics.salesFrequency = transactionDays
    ? metrics.transactions30 / transactionDays
    : null;
  metrics.dailySales =
    coveredDays && metrics.units30 !== null
      ? metrics.units30 / coveredDays
      : null;
  const paired = recent.filter(
    (row) => row.units !== null && row.transactions !== null,
  );
  const pairedTransactions = paired.reduce(
    (sum, row) => sum + row.transactions!,
    0,
  );
  metrics.unitsPerTransaction =
    pairedTransactions > 0
      ? paired.reduce((sum, row) => sum + row.units!, 0) / pairedTransactions
      : null;
  const previous = window(30, 30).filter((row) => row.units !== null),
    previousDays = new Set(previous.map((row) => row.date)).size * 3;
  const previousRate = previousDays
    ? previous.reduce((sum, row) => sum + row.units!, 0) / previousDays
    : null;
  metrics.salesTrend =
    previousRate && metrics.dailySales !== null
      ? (metrics.dailySales / previousRate - 1) * 100
      : null;
  for (const days of [7, 30, 90]) {
    const baseline = history
      .filter(
        (row) =>
          row.date! <= now - days * day &&
          row.date! >= now - (days + 3) * day &&
          row.market !== null,
      )
      .sort((a, b) => b.date! - a.date!)[0];
    metrics["change" + days] =
      baseline?.market && metrics.marketPrice !== null
        ? (metrics.marketPrice / baseline.market - 1) * 100
        : null;
  }
  const listingData = object(payloads.listings?.data?.allListings),
    listings: ObjectValue[] = [];
  if (sku && normalizeLabel(String(sku.languageName)) === "english") {
    for (const [conditionName, finishes] of Object.entries(listingData)) {
      if (condition(conditionName) !== condition(String(sku.condName ?? "")))
        continue;
      for (const [finish, groups] of Object.entries(object(finishes)))
        if (printing(finish) === printing(String(sku.printingName ?? ""))) {
          listings.push(
            ...array(object(groups).standard),
            ...array(object(groups).custom),
          );
        }
    }
  }
  const unique = [
    ...new Map(
      listings.map((row, index) => [String(row.listingId ?? index), row]),
    ).values(),
  ];
  const prices = unique
    .map((row) => numeric(row.price))
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  metrics.listingMedian = prices.length
    ? (prices[Math.floor((prices.length - 1) / 2)] +
        prices[Math.floor(prices.length / 2)]) /
      2
    : null;
  metrics.listingHigh = prices.length ? prices[prices.length - 1] : null;
  metrics.listingCount = unique.length || null;
  const quantities = unique.map((row) => numeric(row.quantity));
  metrics.sampleSupply =
    unique.length && quantities.every((value) => value !== null)
      ? quantities.reduce<number>((sum, value) => sum + value!, 0)
      : null;
  metrics.sampleSellers = unique.length
    ? new Set(unique.map((row) => row.sellerName).filter(Boolean)).size
    : null;
  metrics.available = metrics.marketPrice !== null || metrics.units30 !== null;
  const referencePrices = object(payloads.historic?.data?.prices),
    referenceHistory: ObjectValue[] = [];
  if (sku)
    for (const [date, finishes] of Object.entries(referencePrices)) {
      const matches = Object.entries(object(finishes)).filter(
        ([finish]) => printing(finish) === printing(String(sku.printingName)),
      );
      const values = matches.length === 1 ? matches[0][1] : undefined;
      const price =
        numeric(object(values).marketPrice) ??
        (typeof values === "number" ? values : null);
      if (price !== null)
        referenceHistory.push({ date: timestamp(date), price });
    }
  return {
    metrics,
    detail: {
      product,
      sku,
      history: history.sort((a, b) => a.date! - b.date!),
      referenceHistory,
      recentSales: array(payloads.recent?.data?.sales).slice(0, 100),
      listings: unique,
      coveredDays,
      completeArchive,
      notes: [
        !sku
          ? "No unique SKU matched the CSV condition, printing, and language. Variant-specific fields remain N/A."
          : null,
        "Archive rows cover three-day buckets. Window totals are lower bounds, not exact seven- or thirty-day marketplace totals.",
        "Recent product sales do not report language or units. They are shown separately and are not assigned to this SKU.",
        "Live listings are an English-language US-shipping sample of up to 50 listings. Total marketplace supply and seller counts remain N/A.",
        !completeArchive
          ? "The configured archive page limit was reached. Additional records may be available."
          : null,
      ].filter(Boolean),
      sources: Object.fromEntries(
        Object.entries(payloads).map(([name, body]) => [
          name,
          {
            sourceUpdated: body?.data?.last_updated ?? null,
            processedAt: body?.data?.lastUpdated ?? null,
          },
        ]),
      ),
    },
  };
}
export async function refreshPlan(
  owner: string,
  input: QueryInput & { onlyStale?: boolean },
) {
  const space = await workspace(owner),
    q = buildQuery(owner, space, input),
    p = preferences(space);
  const cards = await database()
    .prepare(
      "SELECT key,productId,skuId,fetchedAt,partial,available FROM (" +
        q.sql +
        ")",
    )
    .bind(...q.values)
    .all<ObjectValue>();
  const targets = cards.results.filter(
    (row) =>
      !input.onlyStale ||
      row.available === 0 ||
      row.partial ||
      !row.fetchedAt ||
      Number(row.fetchedAt) < Date.now() - p.staleHours * 3600000,
  );
  const groups = [
    ...new Map(
      targets.map((row) => [
        row.productId ? "product:" + row.productId : "sku:" + row.skuId,
        row,
      ]),
    ).values(),
  ];
  const unknown = groups.filter((row) => !row.productId).length;
  const base = p.refreshDetail === "complete" ? 17 : 8;
  const minimumCredits = groups.length * base + unknown * 5;
  const maximumCredits =
    minimumCredits + groups.length * (p.archivePages - 1) * 2;
  return {
    keys: groups.map((row) => row.key),
    cards: targets.length,
    groups: groups.length,
    unresolved: unknown,
    minimumCredits,
    maximumCredits,
    minimumRequests:
      groups.length * (p.refreshDetail === "complete" ? 6 : 3) + unknown,
    maximumRequests:
      groups.length *
        ((p.refreshDetail === "complete" ? 6 : 3) + p.archivePages - 1) +
      unknown,
    detail: p.refreshDetail,
    archivePages: p.archivePages,
    note: "Upper estimates assume every unresolved SKU is a different product. Shared products and cached catalog mappings reduce usage. Monthly accounts use plan-specific call costs.",
  };
}
export async function startRefresh(
  owner: string,
  input: QueryInput & { onlyStale?: boolean },
) {
  const space = await workspace(owner);
  await apiKey(space);
  if (space.import_lock)
    throw new AppError(
      "Wait for the CSV import to finish before refreshing market data.",
      409,
    );
  const active = await database()
    .prepare(
      "SELECT id FROM refresh_runs WHERE owner=? AND status='running' LIMIT 1",
    )
    .bind(owner)
    .first();
  if (active)
    throw new AppError(
      "A refresh is already active. Cancel it before starting another.",
      409,
    );
  const plan = await refreshPlan(owner, input);
  if (!plan.groups) throw new AppError("No cards need refreshing.");
  const id = crypto.randomUUID();
  const { keys, ...summary } = plan;
  const created = await database()
    .prepare(
      "INSERT INTO refresh_runs (id,owner,status,started_at,total,detail) SELECT ?,?,'running',?,?,? FROM workspaces WHERE owner=? AND import_lock IS NULL AND active_version=? AND NOT EXISTS (SELECT 1 FROM refresh_runs WHERE owner=? AND status='running')",
    )
    .bind(
      id,
      owner,
      Date.now(),
      plan.groups,
      JSON.stringify({ ...summary, requests: 0, failedRequests: 0 }),
      owner,
      space.active_version,
      owner,
    )
    .run();
  if (!created.meta.changes)
    throw new AppError(
      "Inventory or refresh state changed. Review the estimate and try again.",
      409,
    );
  const batches: D1PreparedStatement[] = [];
  for (let start = 0; start < keys.length; start += 500) {
    const targets = keys
      .slice(start, start + 500)
      .map((key) => ({ id: id + "|" + key, key }));
    batches.push(
      database()
        .prepare(
          "INSERT INTO refresh_targets (id,owner,run_id,card_key) SELECT json_extract(value,'$.id'),?,?,json_extract(value,'$.key') FROM json_each(?)",
        )
        .bind(owner, id, JSON.stringify(targets)),
    );
  }
  if (batches.length) await database().batch(batches);
  return { id, ...plan };
}
export async function cancelRefresh(owner: string, id: string) {
  await database()
    .prepare(
      "UPDATE refresh_runs SET status='cancelled' WHERE owner=? AND id=? AND status='running'",
    )
    .bind(owner, id)
    .run();
  return { cancelled: true };
}
export async function refreshStep(
  owner: string,
  runId: string,
  cardKey: string,
) {
  await activeRun(owner, runId);
  const target = await database()
    .prepare("SELECT id FROM refresh_targets WHERE id=? AND owner=?")
    .bind(runId + "|" + cardKey, owner)
    .first();
  if (!target)
    throw new AppError("This card is not part of the approved refresh.", 403);
  const marker = await cache(owner, "run-item:" + runId + ":" + cardKey);
  if (marker) return JSON.parse(marker.data);
  const space = await workspace(owner),
    key = await apiKey(space),
    p = preferences(space);
  let error: string | undefined;
  try {
    const record = await database()
      .prepare(
        "SELECT c.info,c.quantity,m.product_id FROM cards c LEFT JOIN market m ON m.owner=c.owner AND m.card_key=c.card_key WHERE c.owner=? AND c.version=? AND c.card_key=?",
      )
      .bind(owner, space.active_version ?? "", cardKey)
      .first<{ info: string; quantity: number; product_id: string | null }>();
    if (!record)
      throw new AppError("This card is no longer in the inventory.", 404);
    const info: CardInfo = {
      ...JSON.parse(record.info),
      quantity: record.quantity,
    };
    let productId = info.productId || record.product_id || "";
    if (!productId && info.skuId) {
      const known = await cache(owner, "sku-map:" + info.skuId);
      if (known) productId = String(JSON.parse(known.data).productId ?? "");
      else {
        const lookup = await provider(
          owner,
          runId,
          key,
          "/api/v1/skuprices/" + info.skuId,
          5,
          true,
        );
        productId = String(skuRecord(lookup, info.skuId)?.productId ?? "");
      }
    }
    if (!/^\d+$/.test(productId))
      throw new AppError(
        "The provider did not return a verified parent product for this SKU. Previous data is preserved.",
        422,
      );
    const productKey = runId + ":" + productId;
    const claim = await database()
      .prepare(
        "INSERT OR IGNORE INTO refresh_products (id,owner,run_id,product_id,status) VALUES (?,?,?,?,'running')",
      )
      .bind(productKey, owner, runId, productId)
      .run();
    if (claim.meta.changes) {
      const productBody = await provider(
          owner,
          runId,
          key,
          "/api/v2/products/" + productId,
          1,
          true,
        ),
        product = object(productBody.data);
      if (
        String(product.productId) !== productId ||
        !Array.isArray(product.skus)
      )
        throw new AppError("Product metadata could not be verified.", 422);
      if (
        info.skuId &&
        !array(product.skus).some((sku) => String(sku.skuId) === info.skuId)
      )
        throw new AppError(
          "The product does not contain the inventory SKU. Market data was not assigned.",
          422,
        );
      const maps = array(product.skus).map((sku) => ({
        id: owner + "|sku-map:" + sku.skuId,
        data: JSON.stringify({ productId, sku }),
      }));
      await database()
        .prepare(
          "INSERT INTO api_cache (id,owner,fetched_at,data) SELECT json_extract(value,'$.id'),?,?,json_extract(value,'$.data') FROM json_each(?) WHERE 1 ON CONFLICT(id) DO UPDATE SET data=excluded.data,fetched_at=excluded.fetched_at",
        )
        .bind(owner, Date.now(), JSON.stringify(maps))
        .run();
      const payloads: Record<string, ObjectValue> = {},
        issues: string[] = [];
      const endpoints: [string, string, number][] = [
        ["sku", "/api/v1/skuprices/product/" + productId, 5],
      ];
      if (p.refreshDetail === "complete")
        endpoints.push(
          ["recent", "/api/v2/sales-history/" + productId, 2],
          ["historic", "/api/v2/historic-prices/" + productId, 2],
          ["listings", "/api/v2/livelistings/" + productId, 5],
        );
      let successful = 0;
      for (const [name, path, cost] of endpoints) {
        try {
          payloads[name] = await provider(owner, runId, key, path, cost);
          successful++;
        } catch (problem) {
          if (
            problem instanceof AppError &&
            (problem.status === 403 ||
              problem.status === 409 ||
              problem.status === 429)
          )
            throw problem;
          const old = await cache(owner, path);
          if (old) payloads[name] = JSON.parse(old.data);
          issues.push(
            name +
              ": " +
              (problem instanceof Error ? problem.message : "unavailable"),
          );
        }
      }
      let completeArchive = false;
      const from = new Date(Date.now() - 93 * day).toISOString().slice(0, 10);
      const archiveRows: ObjectValue[] = [];
      const priorArchive = await cache(owner, "archive-rows:" + productId);
      for (let page = 0; page < p.archivePages; page++) {
        const path =
          "/api/v2/sales-history/" +
          productId +
          "/full?limit=100&offset=" +
          page * 100 +
          "&from=" +
          from;
        try {
          const result = await provider(owner, runId, key, path, 2);
          const records = array(result.data?.rows);
          archiveRows.push(...records);
          successful++;
          if (result.data?.available === false || records.length < 100) {
            completeArchive = true;
            break;
          }
          const total = numeric(result.total);
          if (total !== null && page * 100 + records.length >= total) {
            completeArchive = true;
            break;
          }
        } catch (problem) {
          if (
            problem instanceof AppError &&
            (problem.status === 403 ||
              problem.status === 409 ||
              problem.status === 429)
          )
            throw problem;
          const old = await cache(owner, path);
          if (old) archiveRows.push(...array(JSON.parse(old.data).data?.rows));
          issues.push(
            "Sales archive: " +
              (problem instanceof Error ? problem.message : "unavailable"),
          );
          break;
        }
      }
      const previousRows = priorArchive
        ? array(JSON.parse(priorArchive.data).rows)
        : [];
      const mergedRows = [
        ...new Map(
          [...previousRows, ...archiveRows].map((row) => [
            String(row.skuId) + "|" + row.bucketStartDate,
            row,
          ]),
        ).values(),
      ].filter(
        (row) => (timestamp(row.bucketStartDate) ?? 0) >= Date.now() - 96 * day,
      );
      if (archiveRows.length)
        await storeCache(owner, "archive-rows:" + productId, {
          rows: mergedRows,
        });
      payloads.archive = { data: { rows: mergedRows } };
      if (!successful)
        throw new AppError(
          "No requests succeeded. Your previously cached market data is preserved.",
          502,
        );
      const skuIds = array(product.skus).map((sku) => String(sku.skuId));
      const inventory = await database()
        .prepare(
          "SELECT card_key,info,quantity FROM cards WHERE owner=? AND version=? AND (json_extract(info,'$.productId')=? OR json_extract(info,'$.skuId') IN (SELECT value FROM json_each(?)))",
        )
        .bind(
          owner,
          space.active_version ?? "",
          productId,
          JSON.stringify(skuIds),
        )
        .all<{ card_key: string; info: string; quantity: number }>();
      const snapshots = inventory.results.map((row) => {
        const normalized = normalizeMarket(
          { ...JSON.parse(row.info), quantity: row.quantity },
          product,
          payloads,
          completeArchive,
        );
        normalized.metrics.partial = issues.length > 0;
        normalized.metrics.coverageLimited = !completeArchive;
        return {
          id: owner + "|" + row.card_key,
          key: row.card_key,
          data: JSON.stringify(normalized.metrics),
          detail: JSON.stringify({ ...normalized.detail, issues }),
        };
      });
      await database()
        .prepare(
          "INSERT INTO market (id,owner,card_key,product_id,fetched_at,data,detail) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.key'),?,?,json_extract(value,'$.data'),json_extract(value,'$.detail') FROM json_each(?) WHERE 1 ON CONFLICT(id) DO UPDATE SET product_id=excluded.product_id,fetched_at=excluded.fetched_at,data=excluded.data,detail=excluded.detail",
        )
        .bind(owner, productId, Date.now(), JSON.stringify(snapshots))
        .run();
      await database()
        .prepare("UPDATE refresh_products SET status=? WHERE id=? AND owner=?")
        .bind(
          issues.length || !completeArchive ? "partial" : "complete",
          productKey,
          owner,
        )
        .run();
      if (issues.length) error = issues.join(" ");
    }
  } catch (problem) {
    error = problem instanceof Error ? problem.message : "The request failed.";
    if (
      problem instanceof AppError &&
      (problem.status === 403 || problem.status === 429)
    )
      await cancelRefresh(owner, runId);
    if (problem instanceof AppError && problem.status === 409) throw problem;
  }
  await database()
    .prepare(
      "UPDATE refresh_runs SET completed=completed+1,failed=failed+?,detail=json_set(detail,'$.lastError',?) WHERE owner=? AND id=?",
    )
    .bind(error ? 1 : 0, error ?? null, owner, runId)
    .run();
  await database()
    .prepare(
      "UPDATE refresh_runs SET status='complete' WHERE owner=? AND id=? AND status='running' AND completed>=total",
    )
    .bind(owner, runId)
    .run();
  const result = await database()
    .prepare(
      "SELECT id,status,completed,failed,total,spent,detail FROM refresh_runs WHERE owner=? AND id=?",
    )
    .bind(owner, runId)
    .first<ObjectValue>();
  const output = { ...result, error };
  await storeCache(owner, "run-item:" + runId + ":" + cardKey, output);
  return output;
}
