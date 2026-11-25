var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.ts
import { env as env2 } from "cloudflare:workers";

// ../lib/data.ts
import { env } from "cloudflare:workers";

// ../lib/domain.ts
var defaultColumns = [
  "name",
  "set",
  "condition",
  "printing",
  "quantity",
  "marketPrice",
  "units30",
  "dailySales",
  "priority",
  "netProceeds"
];
var defaults = {
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
  presets: []
};
var columns = [
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
    note: "An exact SKU quote where available. Product quotes are identified in card details."
  },
  { key: "listingLow", label: "Lowest listing", kind: "money" },
  { key: "listingMedian", label: "Median listing \xB7 sample", kind: "money" },
  { key: "listingHigh", label: "Highest listing \xB7 sample", kind: "money" },
  { key: "soldAverage", label: "Average sold \xB7 sample", kind: "money" },
  { key: "soldRecent", label: "Latest sold \xB7 sample", kind: "money" },
  { key: "change7", label: "Price change \xB7 7d", kind: "percent" },
  { key: "change30", label: "Price change \xB7 30d", kind: "percent" },
  { key: "change90", label: "Price change \xB7 90d", kind: "percent" },
  ...[7, 14, 30, 60, 90].map((days) => ({
    key: "units" + days,
    label: "Units sold \xB7 " + days + "d",
    kind: "number",
    note: "Exact completed UTC-day totals require daily data for every day. N/A means the requested period is not fully covered."
  })),
  { key: "transactions30", label: "Transactions \xB7 30d", kind: "number" },
  {
    key: "dailySales",
    label: "Units / day",
    kind: "number",
    note: "Average of reported completed daily buckets. Weekly data is never treated as daily sales."
  },
  {
    key: "salesFrequency",
    label: "Sales frequency",
    kind: "number",
    note: "Transactions per completed UTC day when the full 30-day window is covered."
  },
  { key: "unitsPerTransaction", label: "Units / transaction", kind: "number" },
  { key: "lastSoldAt", label: "Last reported sale", kind: "date" },
  { key: "daysSinceSale", label: "Days since sale", kind: "number" },
  { key: "salesTrend", label: "Sales trend", kind: "percent" },
  { key: "activeListings", label: "Total active listings", kind: "number" },
  { key: "totalSupply", label: "Total market stock", kind: "number" },
  { key: "competingSellers", label: "Total competing sellers", kind: "number" },
  { key: "listingCount", label: "Listings \xB7 sample", kind: "number" },
  { key: "sampleSupply", label: "Stock \xB7 sample", kind: "number" },
  { key: "sampleSellers", label: "Sellers \xB7 sample", kind: "number" },
  {
    key: "demandSupply",
    label: "Demand / supply",
    kind: "number",
    note: "Requires verified total supply. A listing sample is not total supply."
  },
  { key: "daysSupply", label: "Days of market supply", kind: "number" },
  { key: "velocityScore", label: "Velocity", kind: "score" },
  {
    key: "demandScore",
    label: "Demand",
    kind: "score",
    note: "A configurable sales velocity and trend proxy."
  },
  { key: "competitionScore", label: "Competition \xB7 sample", kind: "score" },
  { key: "priority", label: "Listing priority", kind: "score" },
  { key: "recommendedPrice", label: "Suggested price", kind: "money" },
  { key: "netProceeds", label: "Net / card", kind: "money" },
  { key: "inventoryValue", label: "Inventory value", kind: "money" },
  { key: "fetchedAt", label: "Market refreshed", kind: "date" }
];
function normalizePreferences(value) {
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
    "maxProducts"
  ]) {
    if (!Number.isFinite(result[field]) || result[field] < 0)
      result[field] = defaults[field];
  }
  result.feePercent = Math.min(100, result.feePercent);
  result.velocityTarget = Math.max(0.01, result.velocityTarget);
  result.maxProducts = Math.max(1, Math.min(1e3, Math.round(result.maxProducts)));
  result.autoMinutes = result.autoMinutes === 0 ? 0 : Math.max(15, result.autoMinutes);
  result.staleHours = Math.max(1, result.staleHours);
  result.autoMinutes = 0;
  result.historyRange = ["month", "quarter", "semi-annual", "annual"].includes(result.historyRange) ? result.historyRange : "month";
  result.includePricing = result.includePricing === true;
  result.includeListings = result.includeListings === true;
  result.prioritizeUnanalyzed = result.prioritizeUnanalyzed !== false;
  result.theme = result.theme === "light" ? "light" : "dark";
  result.visibleColumns = Array.isArray(result.visibleColumns) ? [
    ...new Set(
      result.visibleColumns.filter(
        (key) => columns.some((col) => col.key === key)
      )
    )
  ] : [...defaultColumns];
  if (!result.visibleColumns.length) result.visibleColumns = ["name"];
  result.presets = Array.isArray(result.presets) ? result.presets.slice(0, 30) : [];
  return result;
}
__name(normalizePreferences, "normalizePreferences");

// ../lib/csv.ts
function csvCell(value) {
  const text = value === null || value === void 0 ? "" : String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}
__name(csvCell, "csvCell");

// ../lib/data.ts
var database = /* @__PURE__ */ __name(() => {
  if (!env.DB) throw new Error("Inventory storage is not configured.");
  return env.DB;
}, "database");
var AppError = class extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
  static {
    __name(this, "AppError");
  }
};
async function workspace(owner) {
  await database().prepare("INSERT OR IGNORE INTO workspaces (owner) VALUES (?)").bind(owner).run();
  return await database().prepare("SELECT * FROM workspaces WHERE owner=?").bind(owner).first();
}
__name(workspace, "workspace");
var preferences = /* @__PURE__ */ __name((space) => normalizePreferences(JSON.parse(space.settings)), "preferences");
async function apiKey(_space) {
  if (!env.API_SH_API_KEY) throw new AppError("Set the backend API_SH_API_KEY environment variable to connect API.SH.", 409);
  return env.API_SH_API_KEY;
}
__name(apiKey, "apiKey");
async function state(owner) {
  const space = await workspace(owner), db = database();
  const totals = await db.prepare(
    "SELECT COUNT(*) AS uniqueCards,COALESCE(SUM(c.quantity),0) AS totalCards,SUM(c.quantity*json_extract(m.data,'$.marketPrice')) AS inventoryValue FROM cards c LEFT JOIN market m ON m.owner=c.owner AND m.card_key=c.card_key WHERE c.owner=? AND c.version=?"
  ).bind(owner, space.active_version ?? "").first();
  const refresh = await db.prepare(
    "SELECT id,status,started_at,completed,failed,total,spent FROM refresh_runs WHERE owner=? ORDER BY started_at DESC LIMIT 1"
  ).bind(owner).first();
  const coverage = await db.prepare(`SELECT COUNT(DISTINCT COALESCE(NULLIF(json_extract(c.info,'$.productId'),''),m.product_id,json_extract(a.data,'$.productId'))) AS uniqueProducts,
    COUNT(DISTINCT CASE WHEN COALESCE(json_extract(m.data,'$.analyzed'),json_extract(m.data,'$.available'),0)=1 THEN COALESCE(NULLIF(json_extract(c.info,'$.productId'),''),m.product_id,json_extract(a.data,'$.productId')) END) AS analyzedProducts,
    COUNT(DISTINCT CASE WHEN COALESCE(NULLIF(json_extract(c.info,'$.productId'),''),m.product_id,json_extract(a.data,'$.productId')) IS NULL THEN COALESCE(NULLIF(json_extract(c.info,'$.skuId'),''),c.card_key) END) AS unresolvedProducts
    FROM cards c LEFT JOIN market m ON m.owner=c.owner AND m.card_key=c.card_key LEFT JOIN api_cache a ON a.id=c.owner||'|sku-map:'||json_extract(c.info,'$.skuId') WHERE c.owner=? AND c.version=?`).bind(owner, space.active_version ?? "").first();
  return {
    ...coverage,
    unanalyzedProducts: Number(coverage?.uniqueProducts ?? 0) - Number(coverage?.analyzedProducts ?? 0),
    filename: space.filename,
    headers: JSON.parse(space.headers),
    importedAt: space.imported_at,
    updatedAt: space.updated_at,
    settings: preferences(space),
    connected: !!env.API_SH_API_KEY,
    serverManagedKey: !!env.API_SH_API_KEY,
    usage: JSON.parse(space.usage),
    importing: space.import_lock,
    ...totals,
    refresh
  };
}
__name(state, "state");
async function savePreferences(owner, input) {
  const space = await workspace(owner);
  const settings = normalizePreferences({
    ...preferences(space),
    ...input.settings
  });
  if (input.key) throw new AppError("Configure API_SH_API_KEY on the backend; API keys are not accepted by this page.");
  const secret = input.clearKey ? "" : space.secret;
  await database().prepare("UPDATE workspaces SET settings=?,secret=? WHERE owner=?").bind(JSON.stringify(settings), secret, owner).run();
  return state(owner);
}
__name(savePreferences, "savePreferences");
async function startImport(owner, input) {
  if (!["upload", "update", "replace"].includes(input.mode) || !Array.isArray(input.headers) || !input.headers.length || !Number.isSafeInteger(input.count) || input.count < 1)
    throw new AppError("The import metadata is invalid.");
  const space = await workspace(owner);
  const refreshing = await database().prepare(
    "SELECT id FROM refresh_runs WHERE owner=? AND status='running' LIMIT 1"
  ).bind(owner).first();
  if (refreshing)
    throw new AppError(
      "Cancel the active market refresh before changing inventory.",
      409
    );
  if (space.import_lock) {
    const old = await database().prepare("SELECT created_at FROM imports WHERE id=? AND owner=?").bind(space.import_lock, owner).first();
    if (old && Date.now() - old.created_at < 18e5)
      throw new AppError(
        "An import is already in progress. Cancel it before starting another.",
        409
      );
    await cancelImport(owner, space.import_lock);
  }
  const id = crypto.randomUUID();
  const lock = await database().prepare(
    "UPDATE workspaces SET import_lock=? WHERE owner=? AND import_lock IS NULL AND NOT EXISTS (SELECT 1 FROM refresh_runs WHERE owner=? AND status='running')"
  ).bind(id, owner, owner).run();
  if (!lock.meta.changes)
    throw new AppError("Another import has just started.", 409);
  try {
    await database().prepare(
      "INSERT INTO imports (id,owner,mode,filename,headers,expected,status,created_at) VALUES (?,?,?,?,?,?,'pending',?)"
    ).bind(
      id,
      owner,
      input.mode,
      input.filename,
      JSON.stringify(input.headers),
      input.count,
      Date.now()
    ).run();
  } catch (error2) {
    await database().prepare(
      "UPDATE workspaces SET import_lock=NULL WHERE owner=? AND import_lock=?"
    ).bind(owner, id).run();
    throw error2;
  }
  return { id };
}
__name(startImport, "startImport");
async function importSession(owner, id) {
  const record = await database().prepare("SELECT * FROM imports WHERE owner=? AND id=?").bind(owner, id).first();
  if (!record) throw new AppError("Import not found.", 404);
  return record;
}
__name(importSession, "importSession");
async function uploadChunk(owner, id, start, rows) {
  const session = await importSession(owner, id);
  if (session.status !== "pending")
    throw new AppError("This import is no longer active.", 409);
  if (!Array.isArray(rows) || rows.length > 500 || !Number.isSafeInteger(start) || start < 0 || start + rows.length > session.expected)
    throw new AppError("Invalid import chunk.");
  for (const row of rows)
    if (!row.info?.key || !row.info.name || !/^\d+$/.test(row.info.skuId) && !/^\d+$/.test(row.info.productId) || !Number.isSafeInteger(row.info.quantity) || row.info.quantity < 0 || !row.raw)
      throw new AppError("An inventory row is invalid.");
  const data = rows.map((row, index) => ({
    id: id + ":" + (start + index),
    rowNo: start + index,
    key: row.info.key,
    info: JSON.stringify(row.info),
    raw: JSON.stringify(row.raw)
  }));
  await database().prepare(
    "INSERT INTO inventory_rows (id,owner,version,row_no,card_key,info,raw) SELECT json_extract(value,'$.id'),?,?,json_extract(value,'$.rowNo'),json_extract(value,'$.key'),json_extract(value,'$.info'),json_extract(value,'$.raw') FROM json_each(?) WHERE 1 ON CONFLICT(id) DO UPDATE SET info=excluded.info,raw=excluded.raw,card_key=excluded.card_key"
  ).bind(owner, id, JSON.stringify(data)).run();
  return { received: start + rows.length };
}
__name(uploadChunk, "uploadChunk");
async function cancelImport(owner, id) {
  await database().batch([
    database().prepare(
      "UPDATE imports SET status='cancelled' WHERE owner=? AND id=? AND status='pending'"
    ).bind(owner, id),
    database().prepare(
      "UPDATE workspaces SET import_lock=NULL WHERE owner=? AND import_lock=?"
    ).bind(owner, id),
    database().prepare(
      "DELETE FROM inventory_rows WHERE owner=? AND version=? AND NOT EXISTS (SELECT 1 FROM workspaces WHERE owner=? AND active_version=?)"
    ).bind(owner, id, owner, id)
  ]);
  return { cancelled: true };
}
__name(cancelImport, "cancelImport");
async function commitImport(owner, id) {
  const session = await importSession(owner, id);
  if (session.status === "complete") return state(owner);
  const space = await workspace(owner);
  if (session.status !== "pending" || space.import_lock !== id)
    throw new AppError("This import is no longer active.", 409);
  const count = await database().prepare(
    "SELECT COUNT(*) AS count FROM inventory_rows WHERE owner=? AND version=?"
  ).bind(owner, id).first();
  if (count?.count !== session.expected)
    throw new AppError("The complete CSV has not been uploaded.");
  const headers = session.mode === "update" ? [
    .../* @__PURE__ */ new Set([
      ...JSON.parse(space.headers),
      ...JSON.parse(session.headers)
    ])
  ] : JSON.parse(session.headers);
  const statements = [];
  if (session.mode === "update" && space.active_version)
    statements.push(
      database().prepare(
        "INSERT INTO inventory_rows (id,owner,version,row_no,card_key,info,raw) SELECT ?||':old:'||old.row_no,old.owner,?,?+old.row_no,old.card_key,old.info,old.raw FROM inventory_rows old WHERE old.owner=? AND old.version=? AND NOT EXISTS (SELECT 1 FROM inventory_rows newer WHERE newer.owner=old.owner AND newer.version=? AND newer.card_key=old.card_key)"
      ).bind(id, id, session.expected, owner, space.active_version, id)
    );
  statements.push(
    database().prepare(
      "INSERT INTO cards (id,owner,version,card_key,info,quantity) SELECT ?||':'||card_key,owner,version,card_key,MIN(info),SUM(CAST(json_extract(info,'$.quantity') AS REAL)) FROM inventory_rows WHERE owner=? AND version=? GROUP BY owner,version,card_key"
    ).bind(id, owner, id),
    database().prepare(
      "UPDATE workspaces SET active_version=?,filename=?,headers=?,imported_at=COALESCE(imported_at,?),updated_at=?,import_lock=NULL WHERE owner=? AND import_lock=?"
    ).bind(
      id,
      session.filename,
      JSON.stringify(headers),
      Date.now(),
      Date.now(),
      owner,
      id
    ),
    database().prepare("UPDATE imports SET status='complete' WHERE owner=? AND id=?").bind(owner, id)
  );
  if (space.active_version)
    statements.push(
      database().prepare("DELETE FROM cards WHERE owner=? AND version=?").bind(owner, space.active_version),
      database().prepare("DELETE FROM inventory_rows WHERE owner=? AND version=?").bind(owner, space.active_version)
    );
  await database().batch(statements);
  return state(owner);
}
__name(commitImport, "commitImport");
var marketFields = columns.filter(
  (column) => ![
    "name",
    "number",
    "set",
    "productId",
    "skuId",
    "rarity",
    "condition",
    "printing",
    "language",
    "quantity",
    "fetchedAt"
  ].includes(column.key)
);
function expressions(p) {
  const result = {};
  for (const key of [
    "name",
    "number",
    "set",
    "skuId",
    "rarity",
    "condition",
    "printing",
    "language"
  ])
    result[key] = "json_extract(c.info,'$." + key + "')";
  for (const column of marketFields)
    result[column.key] = "json_extract(m.data,'$." + column.key + "')";
  result.productId = "COALESCE(NULLIF(json_extract(c.info,'$.productId'),''),m.product_id,json_extract((SELECT data FROM api_cache WHERE id=c.owner||'|sku-map:'||json_extract(c.info,'$.skuId')),'$.productId'))";
  result.quantity = "c.quantity";
  result.fetchedAt = "m.fetched_at";
  const velocity = "MIN(100,MAX(0," + result.dailySales + "/" + p.velocityTarget + "*100))";
  result.velocityScore = "CASE WHEN " + result.dailySales + " IS NOT NULL THEN " + velocity + " END";
  result.demandScore = "CASE WHEN " + result.dailySales + " IS NOT NULL THEN (" + velocity + "+MIN(100,MAX(0,50+COALESCE(" + result.salesTrend + ",0)/2)))/2 END";
  result.competitionScore = "CASE WHEN " + result.sampleSellers + " IS NOT NULL THEN MIN(100," + result.sampleSellers + "*5) END";
  result.recommendedPrice = "CASE WHEN " + result.marketPrice + " IS NOT NULL OR " + result.listingLow + " IS NOT NULL THEN MAX(" + p.minimumPrice + ",COALESCE(" + result.listingLow + "," + result.marketPrice + ")) END";
  result.netProceeds = "(" + result.recommendedPrice + "*(1-" + p.feePercent + "/100.0)-" + p.fixedFee + "-" + p.shipping + ")";
  result.inventoryValue = "(" + result.marketPrice + "*c.quantity)";
  const profit = "MIN(100,MAX(0," + result.netProceeds + "*10))", denominator = p.velocityWeight + p.demandWeight + p.profitWeight;
  result.priority = denominator > 0 ? "CASE WHEN " + result.netProceeds + " <= 0 THEN 0 WHEN " + result.dailySales + " IS NOT NULL AND " + result.netProceeds + " IS NOT NULL THEN MAX(0,MIN(100,(" + result.velocityScore + "*" + p.velocityWeight + "+" + result.demandScore + "*" + p.demandWeight + "+" + profit + "*" + p.profitWeight + ")/" + denominator + ")) END" : "NULL";
  return result;
}
__name(expressions, "expressions");
function buildQuery(owner, space, input) {
  const p = preferences(space), e = expressions(p), f = input.filters;
  const values = [owner, space.active_version ?? ""], where = ["c.owner=?", "c.version=?"];
  if (f?.search?.trim()) {
    const search = "%" + f.search.trim().replace(/[\\%_]/g, "\\$&") + "%";
    where.push(
      "(" + ["name", "number", "set", "productId", "skuId"].map((key) => e[key] + " LIKE ? ESCAPE '\\'").join(" OR ") + ")"
    );
    values.push(search, search, search, search, search);
  }
  for (const [key, list] of Object.entries(f?.categories ?? {}))
    if (["condition", "printing", "language", "set", "rarity"].includes(key) && Array.isArray(list) && list.length) {
      where.push(e[key] + " IN (SELECT value FROM json_each(?))");
      values.push(JSON.stringify(list));
    }
  for (const filter of f?.numeric ?? []) {
    if (!columns.some(
      (column) => column.key === filter.field && ["number", "money", "percent", "score"].includes(column.kind)
    ))
      continue;
    if (filter.min !== "" && Number.isFinite(Number(filter.min))) {
      where.push(e[filter.field] + ">=?");
      values.push(Number(filter.min));
    }
    if (filter.max !== "" && Number.isFinite(Number(filter.max))) {
      where.push(e[filter.field] + "<=?");
      values.push(Number(filter.max));
    }
  }
  if (f?.freshness === "analyzed") where.push("COALESCE(json_extract(m.data,'$.analyzed'),json_extract(m.data,'$.available'),0)=1");
  if (f?.freshness === "unanalyzed") where.push("COALESCE(json_extract(m.data,'$.analyzed'),json_extract(m.data,'$.available'),0)=0");
  if (f?.freshness === "missing")
    where.push("(m.id IS NULL OR json_extract(m.data,'$.available')=0)");
  if (f?.freshness === "fresh") {
    where.push(
      "m.fetched_at>=? AND COALESCE(json_extract(m.data,'$.partial'),0)=0"
    );
    values.push(Date.now() - p.staleHours * 36e5);
  }
  if (f?.freshness === "outdated") {
    where.push("(m.fetched_at<? OR json_extract(m.data,'$.partial')=1)");
    values.push(Date.now() - p.staleHours * 36e5);
  }
  if (["lastSoldAt", "fetchedAt"].includes(f?.dateField ?? "")) {
    if (f?.dateFrom && Number.isFinite(Date.parse(f.dateFrom))) {
      where.push(e[f.dateField] + ">=?");
      values.push(Date.parse(f.dateFrom));
    }
    if (f?.dateTo && Number.isFinite(Date.parse(f.dateTo))) {
      where.push(e[f.dateField] + "<?");
      values.push(Date.parse(f.dateTo) + 864e5);
    }
  }
  if (input.selected?.length) {
    where.push("c.card_key IN (SELECT value FROM json_each(?))");
    values.push(JSON.stringify(input.selected));
  }
  const sort = e[input.sort ?? "priority"] ? input.sort ?? "priority" : "name", direction = input.direction === "asc" ? "ASC" : "DESC";
  const select = columns.map((column) => e[column.key] + ' AS "' + column.key + '"').join(",");
  const order = '"' + sort + '" IS NULL,"' + sort + '" ' + direction + ",c.card_key ASC";
  const limit = f?.limit === 50 || f?.limit === 100 ? f.limit : 0;
  const sql = "SELECT c.card_key AS key," + select + ",json_extract(m.data,'$.scope') AS scope,json_extract(m.data,'$.lowerBound') AS lowerBound,COALESCE(json_extract(m.data,'$.analyzed'),json_extract(m.data,'$.available'),0) AS analyzed,json_extract(m.data,'$.partial') AS partial,json_extract(m.data,'$.available') AS available FROM cards c LEFT JOIN market m ON m.owner=c.owner AND m.card_key=c.card_key WHERE " + where.join(" AND ") + " ORDER BY " + order + (limit ? " LIMIT " + limit : "");
  return { sql, values, e };
}
__name(buildQuery, "buildQuery");
async function queryCards(owner, input) {
  const space = await workspace(owner), query = buildQuery(owner, space, input), db = database();
  const page = Math.max(1, Math.floor(Number(input.page) || 1)), pageSize = [25, 50, 100].includes(Number(input.pageSize)) ? Number(input.pageSize) : 50;
  const total = await db.prepare(
    "WITH result AS (" + query.sql + ") SELECT COUNT(*) AS matches,COALESCE(SUM(quantity),0) AS units,SUM(inventoryValue) AS value,COUNT(marketPrice) AS priced,MAX(fetchedAt) AS lastRefreshed FROM result"
  ).bind(...query.values).first();
  const rows = await db.prepare("SELECT * FROM (" + query.sql + ") LIMIT ? OFFSET ?").bind(...query.values, pageSize, (page - 1) * pageSize).all();
  return { rows: rows.results, page, pageSize, ...total };
}
__name(queryCards, "queryCards");
async function facets(owner) {
  const space = await workspace(owner), result = {};
  for (const field of ["set", "condition", "printing", "language", "rarity"]) {
    const rows = await database().prepare(
      "SELECT DISTINCT json_extract(info,'$." + field + "') AS value FROM cards WHERE owner=? AND version=? AND json_extract(info,'$." + field + "')<>'' ORDER BY value"
    ).bind(owner, space.active_version ?? "").all();
    result[field] = rows.results.map((row) => row.value);
  }
  return result;
}
__name(facets, "facets");
async function exportInventory(owner, input) {
  const space = await workspace(owner), query = buildQuery(owner, space, input), headers = input.analysis ? columns.map((column) => column.label) : JSON.parse(space.headers);
  const encoder2 = new TextEncoder(), db = database();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(
          encoder2.encode("\uFEFF" + headers.map(csvCell).join(",") + "\r\n")
        );
        let offset = 0;
        for (; ; ) {
          const sql = input.analysis ? "SELECT * FROM (" + query.sql + ") LIMIT 500 OFFSET ?" : "SELECT r.raw FROM inventory_rows r WHERE r.owner=? AND r.version=? AND r.card_key IN (SELECT key FROM (" + query.sql + ")) ORDER BY r.row_no LIMIT 500 OFFSET ?";
          const args = input.analysis ? [...query.values, offset] : [owner, space.active_version ?? "", ...query.values, offset];
          const rows = await db.prepare(sql).bind(...args).all();
          if (!rows.results.length) break;
          const lines = rows.results.map((row) => {
            if (input.analysis)
              return columns.map((column) => csvCell(row[column.key])).join(",");
            const original = JSON.parse(String(row.raw));
            return headers.map((header) => csvCell(original[header] ?? "")).join(",");
          }).join("\r\n") + "\r\n";
          controller.enqueue(encoder2.encode(lines));
          offset += rows.results.length;
        }
        controller.close();
      } catch (error2) {
        controller.error(error2);
      }
    }
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="' + (input.analysis ? "market-analysis" : "tcgplayer-inventory") + '.csv"',
      "Cache-Control": "no-store"
    }
  });
}
__name(exportInventory, "exportInventory");

// ../lib/api-sh.ts
var API_SH_BASE = "https://api.api.sh";
var DAY = 864e5;
var ranges = ["month", "quarter", "semi-annual", "annual"];
var numberOrNull = /* @__PURE__ */ __name((v) => v !== null && v !== void 0 && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null, "numberOrNull");
function accountSnapshot(body, now = Date.now()) {
  const free = numberOrNull(body.credits?.free);
  const resetAt = Date.parse(body.credits?.free_resets_at ?? "");
  const monthlyUsed = numberOrNull(body.spend?.this_month);
  const monthlyLimit = numberOrNull(body.spend?.monthly_limit);
  const dailyUsed = numberOrNull(body.spend?.today);
  const dailyLimit = numberOrNull(body.spend?.daily_limit);
  const verified = !!body.account?.id && body.account.status === "active" && free !== null && free >= 0 && Number.isFinite(resetAt) && resetAt > now && monthlyUsed !== null && monthlyUsed >= 0 && body.spend?.period === "UTC" && (dailyLimit === null || dailyUsed !== null);
  const available = verified ? Math.max(0, Math.min(free, 1e3 - monthlyUsed, monthlyLimit === null ? Infinity : monthlyLimit - monthlyUsed, dailyLimit === null ? Infinity : dailyLimit - dailyUsed)) : 0;
  return { accountId: String(body.account?.id ?? ""), status: body.account?.status ?? "unknown", freeRemaining: free, available, monthlyUsed, monthlyLimit, dailyUsed, dailyLimit, resetAt: Number.isFinite(resetAt) ? resetAt : null, period: "UTC", verified, updatedAt: now };
}
__name(accountSnapshot, "accountSnapshot");
function chargedCredits(headers, body, fallback) {
  const header = numberOrNull(headers.get("x-credits-used"));
  const metadata = numberOrNull(body.credits_used);
  const values = [header, metadata].filter((v) => v !== null && v >= 0);
  return { used: values.length ? Math.max(...values) : fallback, verified: values.length > 0, combinedRemaining: numberOrNull(headers.get("x-credits-remaining")), requestId: headers.get("x-request-id") };
}
__name(chargedCredits, "chargedCredits");
var label = /* @__PURE__ */ __name((v) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, ""), "label");
var condition = /* @__PURE__ */ __name((v) => label(String(v ?? "").replace(/reverse\s*holofoil|holofoil|reverse\s*foil|etched\s*foil|foil/gi, "")).replace(/^nm$/, "nearmint").replace(/^lp$/, "lightlyplayed").replace(/^mp$/, "moderatelyplayed").replace(/^hp$/, "heavilyplayed").replace(/^dmg$/, "damaged"), "condition");
var printing = /* @__PURE__ */ __name((v) => label(v).replace(/^nonfoil$/, "normal").replace(/^foil$/, "holofoil").replace(/^reversefoil$/, "reverseholofoil"), "printing");
var language = /* @__PURE__ */ __name((v) => ({ en: "english", eng: "english", jp: "japanese", ja: "japanese", fr: "french", de: "german", es: "spanish", it: "italian", ko: "korean", pt: "portuguese" })[label(v)] ?? label(v), "language");
function variantMatches(info, row) {
  const finish = info.printing || String(info.condition ?? "").match(/reverse\s*holofoil|reverse\s*foil|holofoil|etched\s*foil|foil/i)?.[0];
  return (!info.skuId || String(row.sku) === String(info.skuId)) && (!info.condition || condition(info.condition) === condition(row.condition)) && (!finish || printing(finish) === printing(row.printing)) && (!info.language || language(info.language) === language(row.language));
}
__name(variantMatches, "variantMatches");
function normalizeMarket(info, body, extras = {}, now = Date.now()) {
  const candidates = (Array.isArray(body.series) ? body.series : []).filter((s) => s && typeof s === "object" && variantMatches(info, s));
  const sku = candidates.length === 1 ? candidates[0] : null;
  const granularity = body.range === "month" ? "daily" : "weekly";
  const history = (Array.isArray(sku?.points) ? sku.points : []).filter((p) => p && typeof p === "object").map((p) => ({ date: Date.parse(p.date), units: numberOrNull(p.quantity_sold), transactions: numberOrNull(p.transactions), market: numberOrNull(p.market_price), low: numberOrNull(p.low_sale_with_shipping) ?? numberOrNull(p.low_sale), high: numberOrNull(p.high_sale_with_shipping) ?? numberOrNull(p.high_sale) })).filter((p) => Number.isFinite(p.date)).sort((a, b) => a.date - b.date);
  const metrics = { scope: sku ? "Exact SKU" : "Variant not matched", analyzed: true, available: !!sku, lowerBound: false, granularity, provider: "API.SH", marketPrice: null, listingLow: null, listingMedian: null, listingHigh: null, soldAverage: null, soldRecent: null, lastSoldAt: null, daysSinceSale: null, activeListings: null, totalSupply: null, competingSellers: null, listingCount: null, sampleSupply: null, sampleSellers: null, demandSupply: null, daysSupply: null, dailySales: null, salesFrequency: null, transactions30: null, unitsPerTransaction: null, salesTrend: null };
  const today = Math.floor(now / DAY) * DAY;
  const window = /* @__PURE__ */ __name((days, offset = 0) => {
    if (granularity !== "daily") return null;
    const rows = [];
    for (let i = days + offset; i > offset; i--) {
      const matches = history.filter((p) => p.date === today - i * DAY);
      if (matches.length !== 1 || matches[0].units === null || matches[0].units < 0) return null;
      rows.push(matches[0]);
    }
    return rows;
  }, "window");
  for (const days of [7, 14, 30, 60, 90]) {
    const rows = window(days);
    metrics["units" + days] = rows ? rows.reduce((s, p) => s + p.units, 0) : null;
  }
  const recent = window(30), previous = window(30, 30);
  const dailyRows = granularity === "daily" ? history.filter((p) => p.date >= today - 30 * DAY && p.date < today && p.units !== null && p.units >= 0) : [];
  const distinctDays = new Set(dailyRows.map((p) => p.date));
  const coveredDays = distinctDays.size === dailyRows.length ? dailyRows.length : 0;
  metrics.dailySales = coveredDays ? dailyRows.reduce((s, p) => s + p.units, 0) / coveredDays : null;
  const transactions = recent?.every((p) => p.transactions !== null && p.transactions >= 0) ? recent.reduce((s, p) => s + p.transactions, 0) : null;
  metrics.transactions30 = transactions;
  metrics.salesFrequency = transactions === null ? null : transactions / 30;
  metrics.unitsPerTransaction = transactions && metrics.units30 !== null ? metrics.units30 / transactions : null;
  const previousUnits = previous?.reduce((s, p) => s + p.units, 0);
  metrics.salesTrend = previousUnits && metrics.units30 !== null ? (metrics.units30 / previousUnits - 1) * 100 : null;
  metrics.marketPrice = [...history].reverse().find((p) => p.market !== null)?.market ?? null;
  for (const days of [7, 30, 90]) {
    const p = history.find((p2) => p2.date === today - days * DAY && p2.market !== null);
    metrics["change" + days] = p?.market && metrics.marketPrice !== null ? (metrics.marketPrice / p.market - 1) * 100 : null;
  }
  const quote = Array.isArray(extras.product?.skus) ? extras.product.skus.filter((s) => variantMatches(info, s)) : [];
  if (quote.length === 1) {
    metrics.marketPrice = numberOrNull(quote[0].market_price) ?? metrics.marketPrice;
    metrics.listingLow = numberOrNull(quote[0].lowest_price);
  }
  const listings = (Array.isArray(extras.listings?.listings) ? extras.listings.listings : []).filter((r) => sku && variantMatches({ ...info, skuId: String(sku.sku) }, r));
  if (listings.length) {
    const prices = listings.map((r) => numberOrNull(r.price)).filter((n) => n !== null).sort((a, b) => a - b);
    metrics.listingCount = listings.length;
    metrics.sampleSupply = listings.every((r) => numberOrNull(r.quantity) !== null) ? listings.reduce((s, r) => s + Number(r.quantity), 0) : null;
    metrics.sampleSellers = new Set(listings.map((r) => r.seller?.key).filter(Boolean)).size || null;
    metrics.listingMedian = prices.length ? (prices[Math.floor((prices.length - 1) / 2)] + prices[Math.floor(prices.length / 2)]) / 2 : null;
    metrics.listingHigh = prices.at(-1) ?? null;
  }
  return { metrics, detail: { product: { ...extras.product, productId: body.product_id, imageUrl: extras.product?.image }, sku, history, granularity, range: body.range, coveredDays, listings, notes: [!sku ? "No unique SKU matched this card. Sales remain N/A; this does not mean zero sales." : null, granularity === "weekly" ? "This range contains weekly buckets. Exact daily rates and rolling day totals remain N/A." : "Exact totals cover complete UTC days and require a daily bucket for every day in the window. Missing days remain unknown. Units per day uses only reported completed daily buckets.", "Listing and seller samples are not total marketplace supply."].filter(Boolean) } };
}
__name(normalizeMarket, "normalizeMarket");

// ../lib/credits.ts
async function freeGet(key, path) {
  const response = await fetch(API_SH_BASE + path, { headers: { "x-api-key": key, Accept: "application/json" }, signal: AbortSignal.timeout(125e3) });
  if (!response.ok) throw new AppError("API.SH account information is unavailable (HTTP " + response.status + "). No market requests were made.", response.status === 401 ? 409 : 503);
  return response.json();
}
__name(freeGet, "freeGet");
async function syncAccount(owner) {
  const key = await apiKey(await workspace(owner));
  const initial = accountSnapshot(await freeGet(key, "/v1/account"));
  if (!initial.accountId) throw new AppError("API.SH did not identify the account. Refreshing is blocked.", 503);
  const db = database(), id = initial.accountId, token = crypto.randomUUID();
  await db.prepare("INSERT OR IGNORE INTO credit_accounts (id) VALUES (?)").bind(id).run();
  const locked = await db.prepare("UPDATE credit_accounts SET lock_token=?,lock_until=? WHERE id=? AND reserved=0 AND lock_until<?").bind(token, Date.now() + 27e4, id, Date.now()).run();
  if (locked.meta.changes) {
    try {
      const snapshot2 = accountSnapshot(await freeGet(key, "/v1/account"));
      if (snapshot2.accountId !== id) throw new AppError("The API.SH account changed. Refreshing is blocked.", 503);
      await db.prepare("UPDATE credit_accounts SET available=CASE WHEN period=? AND dirty=0 THEN MIN(available,?) ELSE ? END,snapshot=?,period=?,dirty=?,lock_token=NULL,lock_until=0 WHERE id=? AND lock_token=? AND reserved=0").bind(String(snapshot2.resetAt ?? ""), snapshot2.freeRemaining ?? 0, snapshot2.freeRemaining ?? 0, JSON.stringify(snapshot2), String(snapshot2.resetAt ?? ""), snapshot2.verified ? 0 : 1, id, token).run();
    } catch (error2) {
      await db.prepare("UPDATE credit_accounts SET dirty=1,lock_token=NULL,lock_until=0 WHERE id=? AND lock_token=?").bind(id, token).run();
      throw error2;
    }
  }
  const row = await db.prepare("SELECT * FROM credit_accounts WHERE id=?").bind(id).first();
  const saved = JSON.parse(row.snapshot);
  const since = await db.prepare("SELECT COALESCE(SUM(CASE WHEN status='reserved' THEN reserved ELSE COALESCE(charged,reserved) END),0) AS used FROM api_requests WHERE account_id=? AND created_at>=?").bind(id, saved.updatedAt ?? 0).first();
  const snapshot = { ...saved, available: row.dirty || row.lock_until > Date.now() ? 0 : Math.max(0, Math.min(row.available, (saved.available ?? 0) - Number(since?.used ?? 0))), reserved: row.reserved, blocked: !!row.dirty };
  await db.prepare("UPDATE workspaces SET usage=? WHERE owner=?").bind(JSON.stringify(snapshot), owner).run();
  return snapshot;
}
__name(syncAccount, "syncAccount");
async function accountDetails(owner) {
  const snapshot = await syncAccount(owner), key = await apiKey(await workspace(owner));
  const results = await Promise.allSettled([freeGet(key, "/v1/account/usage"), freeGet(key, "/v1/account/logs")]);
  const report = { snapshot, usage: results[0].status === "fulfilled" ? results[0].value : null, logs: results[1].status === "fulfilled" ? results[1].value : null, errors: results.flatMap((r) => r.status === "rejected" ? [String(r.reason?.message ?? r.reason)] : []) };
  await database().prepare("INSERT INTO api_cache (id,owner,fetched_at,data) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET fetched_at=excluded.fetched_at,data=excluded.data").bind(owner + "|api-sh:account-details", owner, Date.now(), JSON.stringify(report)).run();
  const requests = await database().prepare("SELECT id,path,created_at,reserved,charged,status,request_id,metadata FROM api_requests WHERE owner=? ORDER BY created_at DESC LIMIT 50").bind(owner).all();
  return { ...report, requests: requests.results };
}
__name(accountDetails, "accountDetails");
async function reserveCredits(owner, runId, path, cost) {
  const snapshot = await syncAccount(owner);
  if (!snapshot.verified || snapshot.blocked || !snapshot.accountId) throw new AppError("Free credit balance could not be verified. Refreshing is blocked.", 403);
  const db = database(), id = crypto.randomUUID(), now = Date.now();
  const result = await db.batch([
    db.prepare("UPDATE credit_accounts SET available=available-?,reserved=reserved+? WHERE id=? AND available>=? AND dirty=0 AND lock_until<? AND CAST(period AS INTEGER)>? AND COALESCE((SELECT SUM(CASE WHEN status='reserved' THEN reserved ELSE COALESCE(charged,reserved) END) FROM api_requests WHERE account_id=credit_accounts.id AND created_at>=json_extract(credit_accounts.snapshot,'$.updatedAt')),0)+?<=json_extract(snapshot,'$.available') AND EXISTS (SELECT 1 FROM refresh_runs WHERE id=? AND owner=? AND status='running' AND COALESCE((SELECT SUM(CASE WHEN status='reserved' THEN reserved ELSE COALESCE(charged,reserved) END) FROM api_requests WHERE run_id=?),0)+?<=json_extract(detail,'$.maximumCredits'))").bind(cost, cost, snapshot.accountId, cost, now, now, cost, runId, owner, runId, cost),
    db.prepare("INSERT INTO api_requests (id,owner,account_id,run_id,path,created_at,reserved,status) SELECT ?,?,?,?,?,?,?,'reserved' WHERE changes()=1").bind(id, owner, snapshot.accountId, runId, path, now, cost)
  ]);
  if (!result[0].meta.changes || !result[1].meta.changes) throw new AppError("Not enough verified free credits. Refreshing stopped; saved data is preserved.", 403);
  return { id, accountId: snapshot.accountId, cost };
}
__name(reserveCredits, "reserveCredits");
async function settleCredits(reservation, response, body, owner) {
  const charge = response ? chargedCredits(response.headers, body, reservation.cost) : { used: reservation.cost, verified: false, requestId: null, combinedRemaining: null };
  const db = database();
  await db.batch([
    db.prepare("UPDATE credit_accounts SET available=MAX(0,available+?-?),reserved=MAX(0,reserved-?),dirty=CASE WHEN ?=1 THEN dirty ELSE 1 END WHERE id=? AND EXISTS (SELECT 1 FROM api_requests WHERE id=? AND status='reserved')").bind(reservation.cost, charge.used, reservation.cost, charge.verified ? 1 : 0, reservation.accountId, reservation.id),
    db.prepare("UPDATE api_requests SET charged=?,status=?,request_id=?,metadata=? WHERE id=? AND owner=? AND status='reserved'").bind(charge.used, response?.ok ? "ok" : response ? "error" : "uncertain", charge.requestId, JSON.stringify({ chargeVerified: charge.verified, httpStatus: response?.status ?? null, combinedRemaining: charge.combinedRemaining }), reservation.id, owner)
  ]);
  return charge;
}
__name(settleCredits, "settleCredits");

// ../lib/market.ts
async function cache(owner, path) {
  return database().prepare("SELECT data,fetched_at FROM api_cache WHERE id=? AND owner=?").bind(owner + "|api-sh:" + path, owner).first();
}
__name(cache, "cache");
async function saveCache(owner, path, body) {
  await database().prepare("INSERT INTO api_cache (id,owner,fetched_at,data) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET fetched_at=excluded.fetched_at,data=excluded.data").bind(owner + "|api-sh:" + path, owner, Date.now(), JSON.stringify(body)).run();
}
__name(saveCache, "saveCache");
async function activeRun(owner, id) {
  const row = await database().prepare("SELECT * FROM refresh_runs WHERE owner=? AND id=?").bind(owner, id).first();
  if (!row || row.status !== "running") throw new AppError("Refresh cancelled or already finished.", 409);
  return row;
}
__name(activeRun, "activeRun");
function paths(id, options) {
  return ["/tcgplayer/v1/price-history?id=" + id + "&range=" + options.range, ...options.includePricing ? ["/tcgplayer/v1/product?id=" + id + "&sku_prices=1"] : [], ...options.includeListings ? ["/tcgplayer/v1/listings?id=" + id + "&limit=50&page=1"] : []];
}
__name(paths, "paths");
async function provider(owner, runId, key, path, staleHours) {
  const old = await cache(owner, path);
  if (old && Date.now() - old.fetched_at < staleHours * 36e5) return JSON.parse(old.data);
  await activeRun(owner, runId);
  const reservation = await reserveCredits(owner, runId, path, 1);
  let response = null, body = {}, charge;
  try {
    response = await fetch(API_SH_BASE + path, { headers: { "x-api-key": key, Accept: "application/json" }, signal: AbortSignal.timeout(125e3) });
    body = await response.json();
  } finally {
    charge = await settleCredits(reservation, response, body, owner);
    await database().prepare("UPDATE refresh_runs SET spent=spent+?,detail=json_set(detail,'$.requests',COALESCE(json_extract(detail,'$.requests'),0)+1,'$.failedRequests',COALESCE(json_extract(detail,'$.failedRequests'),0)+?) WHERE id=? AND owner=?").bind(charge.used, response?.ok ? 0 : 1, runId, owner).run();
  }
  if (!response?.ok || body.success === false || body.error) throw new AppError("API.SH could not return this product (HTTP " + (response?.status ?? "timeout") + "). Previous data is preserved.", response?.status === 401 || response?.status === 402 || response?.status === 403 ? 403 : response?.status === 429 ? 429 : 502);
  const stored = { body, requestId: charge.requestId, fetchedAt: Date.now(), path };
  await saveCache(owner, path, stored);
  await saveCache(owner, "archive:" + (charge.requestId ?? reservation.id), stored);
  return stored;
}
__name(provider, "provider");
async function refreshPlan(owner, input) {
  const space = await workspace(owner), p = preferences(space), q = buildQuery(owner, space, input);
  const options = { range: ranges.includes(input.range) ? input.range : p.historyRange, includePricing: input.includePricing === true, includeListings: input.includeListings === true, prioritizeUnanalyzed: input.prioritizeUnanalyzed !== false, maxProducts: Math.max(1, Math.min(1e3, Math.floor(input.maxProducts ?? p.maxProducts))) };
  const rows = await database().prepare("SELECT key,productId,skuId,fetchedAt,partial,available,analyzed FROM (" + q.sql + ")").bind(...q.values).all();
  const targets = rows.results.filter((r) => !input.onlyStale || !r.analyzed || r.partial || !r.fetchedAt || r.fetchedAt < Date.now() - p.staleHours * 36e5);
  const groups = [...new Map(targets.filter((r) => /^\d+$/.test(String(r.productId ?? ""))).map((r) => [String(r.productId), r])).values()].sort((a, b) => (options.prioritizeUnanalyzed ? Number(!!a.analyzed) - Number(!!b.analyzed) : 0) || Number(a.fetchedAt ?? 0) - Number(b.fetchedAt ?? 0));
  const cached = await database().prepare("SELECT id,fetched_at FROM api_cache WHERE owner=? AND id LIKE ?").bind(owner, owner + "|api-sh:/tcgplayer/%").all();
  const fresh = new Set(cached.results.filter((r) => r.fetched_at > Date.now() - p.staleHours * 36e5).map((r) => r.id));
  let account = null, accountError = "";
  try {
    account = await syncAccount(owner);
  } catch (e) {
    accountError = e instanceof Error ? e.message : String(e);
  }
  let budget = account?.available ?? 0, cost = 0;
  const chosen = [];
  for (const group of groups) {
    if (chosen.length >= options.maxProducts) break;
    const needed = paths(String(group.productId), options).filter((path) => !fresh.has(owner + "|api-sh:" + path)).length;
    if (needed > budget) continue;
    chosen.push(group);
    budget -= needed;
    cost += needed;
  }
  return { keys: chosen.map((r) => r.key), cards: targets.length, groups: chosen.length, eligibleProducts: groups.length, deferredProducts: groups.length - chosen.length, unresolved: new Set(targets.filter((r) => !r.productId).map((r) => r.skuId || r.key)).size, minimumCredits: cost, maximumCredits: cost, minimumRequests: cost, maximumRequests: cost, options, account, accountError, note: "One credit per product history; optional SKU pricing and one listing/competition page each add one credit. Fresh local results cost zero. " + (groups.length - chosen.length) + " products deferred to a later refresh. SKU-only cards need a verified Product ID; they are never treated as zero sales." };
}
__name(refreshPlan, "refreshPlan");
async function startRefresh(owner, input) {
  const space = await workspace(owner);
  await apiKey(space);
  if (space.import_lock) throw new AppError("Wait for the CSV import to finish.", 409);
  const plan = await refreshPlan(owner, input);
  if (!plan.groups) throw new AppError(plan.accountError || "No products can be refreshed with the available free credits. Add Product IDs for unresolved cards.", 409);
  if (input.approvedCost === void 0 || plan.maximumCredits > input.approvedCost) throw new AppError("The estimate changed. Review the credit cost before refreshing.", 409);
  const id = crypto.randomUUID(), { keys, ...summary } = plan;
  const created = await database().prepare("INSERT INTO refresh_runs (id,owner,status,started_at,total,detail) SELECT ?,?,'running',?,?,? FROM workspaces WHERE owner=? AND import_lock IS NULL AND active_version=? AND NOT EXISTS (SELECT 1 FROM refresh_runs WHERE owner=? AND status='running')").bind(id, owner, Date.now(), plan.groups, JSON.stringify({ ...summary, requests: 0, failedRequests: 0 }), owner, space.active_version, owner).run();
  if (!created.meta.changes) throw new AppError("A refresh or import is already active.", 409);
  await database().prepare("INSERT INTO refresh_targets (id,owner,run_id,card_key) SELECT ?||'|'||value,?,?,value FROM json_each(?)").bind(id, owner, id, JSON.stringify(keys)).run();
  return { id, ...plan };
}
__name(startRefresh, "startRefresh");
async function cancelRefresh(owner, id) {
  await database().prepare("UPDATE refresh_runs SET status='cancelled' WHERE owner=? AND id=? AND status='running'").bind(owner, id).run();
  return { cancelled: true };
}
__name(cancelRefresh, "cancelRefresh");
async function applyHistory(owner, productId, history, extras, sources, issues = [], fetchedAt = Date.now()) {
  if (String(history.product_id) !== productId || !Array.isArray(history.series)) throw new AppError("API.SH returned an unexpected product. Previous data is preserved.", 502);
  if (history.currency && history.currency !== "USD") throw new AppError("The provider returned a non-USD history. Previous data is preserved.", 502);
  const space = await workspace(owner), skuIds = history.series.filter((s) => s && typeof s === "object" && /^\d+$/.test(String(s.sku))).map((s) => String(s.sku));
  for (const sku of skuIds) await database().prepare("INSERT INTO api_cache (id,owner,fetched_at,data) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET fetched_at=excluded.fetched_at,data=excluded.data").bind(owner + "|sku-map:" + sku, owner, Date.now(), JSON.stringify({ productId, verified: true })).run();
  const inventory = await database().prepare("SELECT c.card_key,c.info,c.quantity FROM cards c LEFT JOIN market m ON m.owner=c.owner AND m.card_key=c.card_key WHERE c.owner=? AND c.version=? AND (json_extract(c.info,'$.productId')=? OR m.product_id=? OR json_extract(c.info,'$.skuId') IN (SELECT value FROM json_each(?)))").bind(owner, space.active_version ?? "", productId, productId, JSON.stringify(skuIds)).all();
  for (const row of inventory.results) {
    const previous = await database().prepare("SELECT data,detail,fetched_at FROM market WHERE owner=? AND card_key=?").bind(owner, row.card_key).first();
    if (previous && previous.fetched_at > fetchedAt) continue;
    const normalized = normalizeMarket({ ...JSON.parse(row.info), quantity: row.quantity }, history, extras, fetchedAt);
    if (!normalized.metrics.available && previous && JSON.parse(previous.data).available) continue;
    normalized.metrics.partial = issues.length > 0;
    await database().prepare("INSERT INTO market (id,owner,card_key,product_id,fetched_at,data,detail) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET product_id=excluded.product_id,fetched_at=excluded.fetched_at,data=excluded.data,detail=excluded.detail").bind(owner + "|" + row.card_key, owner, row.card_key, productId, fetchedAt, JSON.stringify(normalized.metrics), JSON.stringify({ ...normalized.detail, sources, issues })).run();
  }
}
__name(applyHistory, "applyHistory");
async function refreshStep(owner, runId, cardKey) {
  const run = await activeRun(owner, runId);
  const target = await database().prepare("SELECT id FROM refresh_targets WHERE id=? AND owner=?").bind(runId + "|" + cardKey, owner).first();
  if (!target) throw new AppError("This product is not part of the approved refresh.", 403);
  const marker = await cache(owner, "run-item:" + runId + ":" + cardKey);
  if (marker) return JSON.parse(marker.data);
  const space = await workspace(owner), q = buildQuery(owner, space, { selected: [cardKey] }), row = await database().prepare("SELECT productId FROM (" + q.sql + ")").bind(...q.values).first();
  if (!row?.productId) throw new AppError("A verified Product ID is required.", 409);
  const productId = String(row.productId), claim = await database().prepare("INSERT OR IGNORE INTO refresh_products (id,owner,run_id,product_id,status) VALUES (?,?,?,?,'running')").bind(runId + ":" + productId, owner, runId, productId).run();
  if (!claim.meta.changes) throw new AppError("This product was already requested in this refresh.", 409);
  let error2;
  try {
    const options = JSON.parse(run.detail).options, p = preferences(space), key = await apiKey(space), results = [], issues = [];
    for (const path of paths(productId, options)) {
      try {
        results.push(await provider(owner, runId, key, path, p.staleHours));
      } catch (e) {
        if (!results.length) throw e;
        issues.push(e instanceof Error ? e.message : String(e));
        if (e instanceof AppError && [403, 409, 429].includes(e.status)) await cancelRefresh(owner, runId);
        break;
      }
    }
    const extras = {};
    for (const r of results.slice(1)) {
      if (r.path.startsWith("/tcgplayer/v1/product?")) extras.product = r.body;
      if (r.path.startsWith("/tcgplayer/v1/listings?")) extras.listings = r.body;
    }
    await applyHistory(owner, productId, results[0].body, extras, results.map((r) => ({ path: r.path, requestId: r.requestId, fetchedAt: r.fetchedAt })), issues, results[0].fetchedAt);
    if (issues.length) error2 = issues.join(" ");
  } catch (e) {
    error2 = e instanceof Error ? e.message : String(e);
    if (e instanceof AppError && [403, 409, 429].includes(e.status)) await cancelRefresh(owner, runId);
  }
  await database().prepare("UPDATE refresh_products SET status=? WHERE id=? AND owner=?").bind(error2 ? "error" : "complete", runId + ":" + productId, owner).run();
  await database().prepare("UPDATE refresh_runs SET completed=completed+1,failed=failed+?,detail=json_set(detail,'$.lastError',?) WHERE owner=? AND id=?").bind(error2 ? 1 : 0, error2 ?? null, owner, runId).run();
  await database().prepare("UPDATE refresh_runs SET status='complete' WHERE owner=? AND id=? AND status='running' AND completed>=total").bind(owner, runId).run();
  const result = await database().prepare("SELECT id,status,completed,failed,total,spent,detail FROM refresh_runs WHERE owner=? AND id=?").bind(owner, runId).first();
  const output = { ...result, error: error2 };
  await saveCache(owner, "run-item:" + runId + ":" + cardKey, output);
  return output;
}
__name(refreshStep, "refreshStep");
async function recoverResult(owner, id) {
  const row = await database().prepare("SELECT * FROM api_requests WHERE id=? AND owner=?").bind(id, owner).first();
  if (!row?.request_id || Date.now() - row.created_at >= 30 * DAY) throw new AppError("This request has no recoverable result within API.SH's 30-day retention.", 410);
  const body = await freeGet(await apiKey(await workspace(owner)), "/v1/results/" + encodeURIComponent(row.request_id));
  await saveCache(owner, row.path, { body, requestId: row.request_id, fetchedAt: row.created_at, path: row.path, recoveredAt: Date.now() });
  if (row.path.startsWith("/tcgplayer/v1/price-history?")) await applyHistory(owner, String(body.product_id), body, {}, [{ requestId: row.request_id, recovered: true }], [], row.created_at);
  return { recovered: true, creditsUsed: 0 };
}
__name(recoverResult, "recoverResult");
async function linkProduct(owner, cardKey, productId) {
  if (!/^\d+$/.test(productId)) throw new AppError("Enter the numeric Product ID from the TCGplayer product URL.");
  const space = await workspace(owner), row = await database().prepare("SELECT info FROM cards WHERE owner=? AND version=? AND card_key=?").bind(owner, space.active_version ?? "", cardKey).first();
  if (!row) throw new AppError("Card not found.", 404);
  const info = JSON.parse(row.info);
  if (!info.skuId) throw new AppError("This row already has an imported Product ID. Update it through your CSV.");
  await database().prepare("INSERT INTO api_cache (id,owner,fetched_at,data) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET fetched_at=excluded.fetched_at,data=excluded.data").bind(owner + "|sku-map:" + info.skuId, owner, Date.now(), JSON.stringify({ productId, userProvided: true })).run();
  return { saved: true };
}
__name(linkProduct, "linkProduct");

// ../lib/http-api.ts
async function handleApi(request, owner, path, allowedOrigin2) {
  try {
    if (!owner) throw new AppError("Sign in to access your inventory.", 401);
    const url = new URL(request.url);
    if (request.method === "POST") {
      const origin = request.headers.get("origin");
      if (origin && origin !== (allowedOrigin2 ?? url.origin))
        throw new AppError("This request came from another website.", 403);
      const body = await request.json();
      if (path === "preferences")
        return Response.json(await savePreferences(owner, body));
      if (path === "imports/start")
        return Response.json(await startImport(owner, body));
      if (path === "imports/chunk")
        return Response.json(
          await uploadChunk(owner, body.id, body.start, body.rows)
        );
      if (path === "imports/commit")
        return Response.json(await commitImport(owner, body.id));
      if (path === "imports/cancel")
        return Response.json(await cancelImport(owner, body.id));
      if (path === "market/recover") return Response.json(await recoverResult(owner, body.id));
      if (path === "market/product") return Response.json(await linkProduct(owner, body.key, String(body.productId ?? "")));
      if (path === "market/plan")
        return Response.json(await refreshPlan(owner, body));
      if (path === "market/start")
        return Response.json(await startRefresh(owner, body));
      if (path === "market/step")
        return Response.json(await refreshStep(owner, body.id, body.key));
      if (path === "market/cancel")
        return Response.json(await cancelRefresh(owner, body.id));
      if (path === "export") return exportInventory(owner, body);
    } else {
      if (path === "account") return Response.json(await syncAccount(owner), { headers: { "Cache-Control": "no-store" } });
      if (path === "account/details") return Response.json(await accountDetails(owner), { headers: { "Cache-Control": "no-store" } });
      if (path === "state")
        return Response.json(await state(owner), {
          headers: { "Cache-Control": "no-store" }
        });
      if (path === "facets") return Response.json(await facets(owner));
      if (path === "cards")
        return Response.json(
          await queryCards(
            owner,
            JSON.parse(url.searchParams.get("q") ?? "{}")
          ),
          { headers: { "Cache-Control": "no-store" } }
        );
      if (path === "card") {
        const space = await workspace(owner), key = url.searchParams.get("key") ?? "";
        const card = await database().prepare(
          "SELECT info,quantity FROM cards WHERE owner=? AND version=? AND card_key=?"
        ).bind(owner, space.active_version ?? "", key).first();
        if (!card) throw new AppError("Card not found.", 404);
        const market = await database().prepare(
          "SELECT data,detail,fetched_at FROM market WHERE owner=? AND card_key=?"
        ).bind(owner, key).first();
        const raw = await database().prepare(
          "SELECT raw FROM inventory_rows WHERE owner=? AND version=? AND card_key=? ORDER BY row_no LIMIT 20"
        ).bind(owner, space.active_version ?? "", key).all();
        return Response.json({
          card: { ...JSON.parse(card.info), quantity: card.quantity },
          market: market ? JSON.parse(market.data) : null,
          detail: market ? JSON.parse(market.detail) : null,
          fetchedAt: market?.fetched_at,
          originals: raw.results.map((row) => JSON.parse(row.raw))
        });
      }
    }
    throw new AppError("Not found.", 404);
  } catch (error2) {
    const quota = /quota|daily.*limit|storage.*limit|D1_ERROR.*limit/i.test(error2 instanceof Error ? error2.message : "");
    const status = quota ? 503 : error2 instanceof AppError ? error2.status : 500;
    return Response.json(
      {
        error: quota ? "Cloudflare free-plan capacity was reached. Your saved inventory is preserved. Try again after the daily UTC reset; no paid upgrade was enabled." : error2 instanceof Error ? error2.message : "The request could not be completed."
      },
      { status, headers: { "Cache-Control": "no-store" } }
    );
  }
}
__name(handleApi, "handleApi");

// generated/schema.ts
var schema = ["CREATE TABLE `api_cache` (\n	`id` text PRIMARY KEY NOT NULL,\n	`owner` text NOT NULL,\n	`fetched_at` integer NOT NULL,\n	`data` text NOT NULL\n)", "CREATE TABLE `cards` (\n	`id` text PRIMARY KEY NOT NULL,\n	`owner` text NOT NULL,\n	`version` text NOT NULL,\n	`card_key` text NOT NULL,\n	`info` text NOT NULL,\n	`quantity` real NOT NULL\n)", "CREATE UNIQUE INDEX `cards_version_key` ON `cards` (`owner`,`version`,`card_key`)", "CREATE TABLE `imports` (\n	`id` text PRIMARY KEY NOT NULL,\n	`owner` text NOT NULL,\n	`mode` text NOT NULL,\n	`filename` text NOT NULL,\n	`headers` text NOT NULL,\n	`expected` integer NOT NULL,\n	`status` text NOT NULL,\n	`created_at` integer NOT NULL\n)", "CREATE TABLE `inventory_rows` (\n	`id` text PRIMARY KEY NOT NULL,\n	`owner` text NOT NULL,\n	`version` text NOT NULL,\n	`row_no` integer NOT NULL,\n	`card_key` text NOT NULL,\n	`info` text NOT NULL,\n	`raw` text NOT NULL\n)", "CREATE INDEX `rows_owner_version` ON `inventory_rows` (`owner`,`version`,`row_no`)", "CREATE INDEX `rows_card` ON `inventory_rows` (`owner`,`version`,`card_key`)", "CREATE TABLE `market` (\n	`id` text PRIMARY KEY NOT NULL,\n	`owner` text NOT NULL,\n	`card_key` text NOT NULL,\n	`product_id` text,\n	`fetched_at` integer NOT NULL,\n	`data` text NOT NULL,\n	`detail` text NOT NULL\n)", "CREATE UNIQUE INDEX `market_owner_card` ON `market` (`owner`,`card_key`)", "CREATE TABLE `refresh_products` (\n	`id` text PRIMARY KEY NOT NULL,\n	`owner` text NOT NULL,\n	`run_id` text NOT NULL,\n	`product_id` text NOT NULL,\n	`status` text NOT NULL\n)", "CREATE TABLE `refresh_runs` (\n	`id` text PRIMARY KEY NOT NULL,\n	`owner` text NOT NULL,\n	`status` text NOT NULL,\n	`started_at` integer NOT NULL,\n	`completed` integer DEFAULT 0 NOT NULL,\n	`failed` integer DEFAULT 0 NOT NULL,\n	`spent` real DEFAULT 0 NOT NULL,\n	`total` integer NOT NULL,\n	`detail` text NOT NULL\n)", "CREATE TABLE `workspaces` (\n	`owner` text PRIMARY KEY NOT NULL,\n	`active_version` text,\n	`filename` text,\n	`headers` text DEFAULT '[]' NOT NULL,\n	`imported_at` integer,\n	`updated_at` integer,\n	`settings` text DEFAULT '{}' NOT NULL,\n	`secret` text DEFAULT '' NOT NULL,\n	`usage` text DEFAULT '{}' NOT NULL,\n	`import_lock` text\n)", "CREATE TABLE `refresh_targets` (\n	`id` text PRIMARY KEY NOT NULL,\n	`owner` text NOT NULL,\n	`run_id` text NOT NULL,\n	`card_key` text NOT NULL\n)", "CREATE TABLE `api_requests` (\n	`id` text PRIMARY KEY NOT NULL,\n	`owner` text NOT NULL,\n	`account_id` text NOT NULL,\n	`run_id` text,\n	`path` text NOT NULL,\n	`created_at` integer NOT NULL,\n	`reserved` real NOT NULL,\n	`charged` real,\n	`status` text NOT NULL,\n	`request_id` text,\n	`metadata` text DEFAULT '{}' NOT NULL\n)", "CREATE INDEX `requests_owner_date` ON `api_requests` (`owner`,`created_at`)", "CREATE TABLE `credit_accounts` (\n	`id` text PRIMARY KEY NOT NULL,\n	`available` real DEFAULT 0 NOT NULL,\n	`reserved` real DEFAULT 0 NOT NULL,\n	`dirty` integer DEFAULT 1 NOT NULL,\n	`period` text DEFAULT '' NOT NULL,\n	`snapshot` text DEFAULT '{}' NOT NULL,\n	`lock_token` text,\n	`lock_until` integer DEFAULT 0 NOT NULL\n)", "CREATE TABLE `auth_codes` (\n	`id` text PRIMARY KEY NOT NULL,\n	`owner` text NOT NULL,\n	`challenge` text NOT NULL,\n	`expires_at` integer NOT NULL\n)"];

// auth.ts
var encoder = new TextEncoder();
var encode = /* @__PURE__ */ __name((bytes) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""), "encode");
var randomCode = /* @__PURE__ */ __name(() => encode(crypto.getRandomValues(new Uint8Array(32))), "randomCode");
var challengeFor = /* @__PURE__ */ __name(async (value) => encode(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)))), "challengeFor");
var decode = /* @__PURE__ */ __name((value) => Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0)), "decode");
var keyFor = /* @__PURE__ */ __name((secret) => crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]), "keyFor");
async function sign(data, secret) {
  if (secret.length < 32) throw new Error("Session signing secret is not configured.");
  const payload = encode(encoder.encode(JSON.stringify(data))), signature = await crypto.subtle.sign("HMAC", await keyFor(secret), encoder.encode(payload));
  return payload + "." + encode(new Uint8Array(signature));
}
__name(sign, "sign");
async function verify(value, secret, kind, now = Date.now()) {
  if (!value || value.length > 2048 || secret.length < 32) return null;
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra !== void 0) return null;
  try {
    if (!await crypto.subtle.verify("HMAC", await keyFor(secret), decode(signature), encoder.encode(payload))) return null;
    const data = JSON.parse(new TextDecoder().decode(decode(payload)));
    return data.kind === kind && Number.isFinite(data.exp) && data.exp > now ? data : null;
  } catch {
    return null;
  }
}
__name(verify, "verify");
function allowedOrigin(origin, frontend) {
  if (!origin) return true;
  try {
    return origin === new URL(frontend).origin;
  } catch {
    return false;
  }
}
__name(allowedOrigin, "allowedOrigin");
async function authenticatedOwner(request, secret, owner) {
  const header = request.headers.get("Authorization") ?? "";
  const data = header.startsWith("Bearer ") ? await verify(header.slice(7), secret, "session") : null;
  return data?.owner === owner ? owner : null;
}
__name(authenticatedOwner, "authenticatedOwner");
function oauthCookie(value, seconds = 600) {
  return "__Host-tcg_oauth=" + value + "; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=" + seconds;
}
__name(oauthCookie, "oauthCookie");
function readOauthCookie(request) {
  return request.headers.get("Cookie")?.split(";").map((s) => s.trim()).find((s) => s.startsWith("__Host-tcg_oauth="))?.slice("__Host-tcg_oauth=".length) ?? "";
}
__name(readOauthCookie, "readOauthCookie");

// worker.ts
var ready;
async function ensureSchema() {
  if (!env2.DB) throw new Error("Database binding is missing.");
  if (!ready) ready = (async () => {
    const existing = await env2.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='auth_codes'").first();
    if (existing) return;
    await env2.DB.batch(schema.map((sql) => env2.DB.prepare(sql)));
  })().catch((error2) => {
    ready = void 0;
    throw error2;
  });
  return ready;
}
__name(ensureSchema, "ensureSchema");
function redirect(url, cookie) {
  const headers = new Headers({ Location: url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  if (cookie) headers.set("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}
__name(redirect, "redirect");
function error(message, status = 400) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}
__name(error, "error");
function config() {
  const frontend = env2.FRONTEND_URL ?? "", owner = env2.OWNER_GITHUB_ID ?? "", secret = env2.SESSION_SECRET ?? "";
  if (env2.FREE_ONLY !== "true") throw new Error("Free-only deployment guard is disabled. The backend is stopped.");
  if (!/^\d+$/.test(owner) || !frontend.startsWith("https://") || secret.length < 32) throw new Error("Private sign-in has not been configured.");
  return { frontend, owner, secret };
}
__name(config, "config");
async function route(request) {
  const url = new URL(request.url);
  if (url.pathname === "/health") return Response.json({ service: "tcg-data-api", freeOnly: env2.FREE_ONLY === "true", databaseConfigured: !!env2.DB, apiConfigured: !!env2.API_SH_API_KEY, signInConfigured: !!(env2.GITHUB_CLIENT_ID && env2.GITHUB_CLIENT_SECRET && env2.SESSION_SECRET) }, { headers: { "Cache-Control": "no-store" } });
  const { frontend, owner, secret } = config();
  if (!allowedOrigin(request.headers.get("Origin"), frontend)) return error("This website is not allowed to access the private backend.", 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (url.pathname === "/auth/login" && request.method === "GET") {
    if (!env2.GITHUB_CLIENT_ID || !env2.GITHUB_CLIENT_SECRET) return error("GitHub sign-in setup is not complete.", 503);
    const frontendChallenge = url.searchParams.get("challenge") ?? "";
    if (!/^[A-Za-z0-9_-]{43}$/.test(frontendChallenge)) return error("Start sign-in from the app.");
    const state2 = randomCode(), verifier = randomCode(), signed = await sign({ kind: "oauth", exp: Date.now() + 6e5, state: state2, verifier, challenge: frontendChallenge }, secret);
    const github = new URL("https://github.com/login/oauth/authorize");
    github.search = new URLSearchParams({ client_id: env2.GITHUB_CLIENT_ID, redirect_uri: url.origin + "/auth/callback", state: state2, code_challenge: await challengeFor(verifier), code_challenge_method: "S256" }).toString();
    return redirect(github.href, oauthCookie(signed));
  }
  if (url.pathname === "/auth/callback" && request.method === "GET") {
    const temporary = await verify(readOauthCookie(request), secret, "oauth"), code = url.searchParams.get("code");
    const fail = /* @__PURE__ */ __name((message) => redirect(frontend + "#error=" + encodeURIComponent(message), oauthCookie("", 0)), "fail");
    if (!temporary?.verifier || !temporary.challenge || temporary.state !== url.searchParams.get("state") || !code) return fail("Sign-in could not be verified. Please try again.");
    const exchanged = await fetch("https://github.com/login/oauth/access_token", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ client_id: env2.GITHUB_CLIENT_ID, client_secret: env2.GITHUB_CLIENT_SECRET, code, redirect_uri: url.origin + "/auth/callback", code_verifier: temporary.verifier }), signal: AbortSignal.timeout(25e3) });
    const token = await exchanged.json();
    if (!exchanged.ok || !token.access_token) return fail("GitHub could not complete sign-in.");
    const profile = await fetch("https://api.github.com/user", { headers: { Authorization: "Bearer " + token.access_token, Accept: "application/vnd.github+json", "User-Agent": "TCG-Data" }, signal: AbortSignal.timeout(25e3) });
    const identity = await profile.json();
    if (!profile.ok || String(identity.id) !== owner) return fail("This inventory is only available to its owner.");
    await ensureSchema();
    const loginCode = randomCode();
    await env2.DB.batch([env2.DB.prepare("DELETE FROM auth_codes WHERE expires_at<?").bind(Date.now()), env2.DB.prepare("INSERT INTO auth_codes (id,owner,challenge,expires_at) VALUES (?,?,?,?)").bind(await challengeFor(loginCode), owner, temporary.challenge, Date.now() + 6e4)]);
    return redirect(frontend + "#code=" + loginCode, oauthCookie("", 0));
  }
  if (url.pathname === "/auth/exchange" && request.method === "POST") {
    if (request.headers.get("Origin") !== new URL(frontend).origin) return error("Invalid sign-in origin.", 403);
    if (Number(request.headers.get("Content-Length") ?? 0) > 2048) return error("Invalid sign-in request.");
    const body = await request.json();
    if (!/^[A-Za-z0-9_-]{43}$/.test(body.code ?? "") || !/^[A-Za-z0-9_-]{43}$/.test(body.verifier ?? "")) return error("Invalid sign-in request.");
    const login = await env2.DB.prepare("DELETE FROM auth_codes WHERE id=? AND challenge=? AND expires_at>? RETURNING owner").bind(await challengeFor(body.code), await challengeFor(body.verifier), Date.now()).first();
    if (!login || login.owner !== owner) return error("Sign-in expired or was already used. Please try again.", 401);
    return Response.json({ token: await sign({ kind: "session", owner, exp: Date.now() + 8 * 36e5 }, secret) }, { headers: { "Cache-Control": "no-store" } });
  }
  if (!url.pathname.startsWith("/api/")) return error("Not found.", 404);
  if (!["GET", "POST"].includes(request.method)) return error("Method not allowed.", 405);
  const authenticated = await authenticatedOwner(request, secret, owner);
  if (!authenticated) return error("Sign in to access your private inventory.", 401);
  await ensureSchema();
  return handleApi(request, authenticated, url.pathname.slice(5), new URL(frontend).origin);
}
__name(route, "route");
var worker_default = {
  async fetch(request) {
    let response;
    try {
      response = await route(request);
    } catch (e) {
      const quota = /quota|limit.*exceeded|exceeded.*limit/i.test(e instanceof Error ? e.message : "");
      response = error(quota ? "Cloudflare free-plan capacity was reached. Try again after the daily UTC reset. No paid upgrade was enabled." : e instanceof Error ? e.message : "The private backend is unavailable.", 503);
    }
    const headers = new Headers(response.headers), origin = request.headers.get("Origin");
    if (origin && allowedOrigin(origin, env2.FRONTEND_URL ?? "")) {
      headers.set("Access-Control-Allow-Origin", origin);
      headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      headers.set("Access-Control-Allow-Headers", "Authorization,Content-Type");
      headers.set("Access-Control-Expose-Headers", "Content-Disposition");
      headers.set("Vary", "Origin");
    }
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("Cache-Control", "no-store");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
};

// ../node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env3, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env3);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env3, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env3);
  } catch (e) {
    const error2 = reduceError(e);
    return Response.json(error2, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-M5ubqe/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// ../node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env3, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env3, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env3, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env3, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-M5ubqe/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env3, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env3, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env3, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env3, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env3, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env3, ctx) => {
      this.env = env3;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
