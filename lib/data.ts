import { env } from "cloudflare:workers";
import {
  columns,
  inventoryColumns,
  inventoryPreferences,
  csvColumnKey,
  normalizePreferences,
  type Preferences,
  type Filters,
  type ImportRow,
} from "./domain";
import { csvCell } from "./csv";

export type Workspace = {
  owner: string;
  active_version: string | null;
  filename: string | null;
  headers: string;
  imported_at: number | null;
  updated_at: number | null;
  settings: string;
  secret: string;
  usage: string;
  import_lock: string | null;
};
export const database = () => {
  if (!env.DB) throw new Error("Inventory storage is not configured.");
  return env.DB;
};
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export async function workspace(owner: string) {
  await database()
    .prepare("INSERT OR IGNORE INTO workspaces (owner) VALUES (?)")
    .bind(owner)
    .run();
  return (await database()
    .prepare("SELECT * FROM workspaces WHERE owner=?")
    .bind(owner)
    .first<Workspace>())!;
}
export const preferences = (space: Workspace) =>
  inventoryPreferences(normalizePreferences(JSON.parse(space.settings)), JSON.parse(space.headers));
export async function protectSecret(value: string) {
  const secret = env.CREDENTIAL_ENCRYPTION_KEY;
  if (!secret)
    throw new AppError(
      "The server encryption key has not been configured.",
      503,
    );
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(atob(secret), (c) => c.charCodeAt(0)),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(value),
  );
  return (
    btoa(String.fromCharCode(...iv)) +
    "." +
    btoa(String.fromCharCode(...new Uint8Array(encrypted)))
  );
}
export async function apiKey(_space?: Workspace) {
  if (!env.API_SH_API_KEY) throw new AppError("Set the backend API_SH_API_KEY environment variable to connect API.SH.", 409);
  return env.API_SH_API_KEY;
}
export async function state(owner: string) {
  const space = await workspace(owner),
    db = database();
  const totals = await db
    .prepare(
      "SELECT COUNT(*) AS uniqueCards,COALESCE(SUM(c.quantity),0) AS totalCards,SUM(c.quantity*json_extract(m.data,'$.marketPrice')) AS inventoryValue FROM cards c LEFT JOIN market m ON m.owner=c.owner AND m.card_key=c.card_key WHERE c.owner=? AND c.version=?",
    )
    .bind(owner, space.active_version ?? "")
    .first();
  const refresh = await db
    .prepare(
      "SELECT id,status,started_at,completed,failed,total,spent FROM refresh_runs WHERE owner=? ORDER BY started_at DESC LIMIT 1",
    )
    .bind(owner)
    .first();
  const coverage = await db.prepare(`SELECT COUNT(DISTINCT COALESCE(NULLIF(json_extract(c.info,'$.productId'),''),m.product_id,json_extract(a.data,'$.productId'))) AS uniqueProducts,
    COUNT(DISTINCT CASE WHEN COALESCE(json_extract(m.data,'$.analyzed'),json_extract(m.data,'$.available'),0)=1 THEN COALESCE(NULLIF(json_extract(c.info,'$.productId'),''),m.product_id,json_extract(a.data,'$.productId')) END) AS analyzedProducts,
    COUNT(DISTINCT CASE WHEN COALESCE(NULLIF(json_extract(c.info,'$.productId'),''),m.product_id,json_extract(a.data,'$.productId')) IS NULL THEN COALESCE(NULLIF(json_extract(c.info,'$.skuId'),''),c.card_key) END) AS unresolvedProducts
    FROM cards c LEFT JOIN market m ON m.owner=c.owner AND m.card_key=c.card_key LEFT JOIN api_cache a ON a.id=c.owner||'|sku-map:'||json_extract(c.info,'$.skuId') WHERE c.owner=? AND c.version=?`).bind(owner,space.active_version??"").first<any>();
  return {
    ...coverage,
    unanalyzedProducts: Number(coverage?.uniqueProducts??0)-Number(coverage?.analyzedProducts??0),
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
    refresh,
  };
}
export async function savePreferences(
  owner: string,
  input: { settings?: Partial<Preferences>; key?: string; clearKey?: boolean },
) {
  const space = await workspace(owner);
  const settings = normalizePreferences({
    ...preferences(space),
    ...input.settings,
  });
  if (input.key) throw new AppError("Configure API_SH_API_KEY on the backend; API keys are not accepted by this page.");
  const secret = input.clearKey ? "" : space.secret;
  await database()
    .prepare("UPDATE workspaces SET settings=?,secret=? WHERE owner=?")
    .bind(JSON.stringify(settings), secret, owner)
    .run();
  return state(owner);
}
export async function startImport(
  owner: string,
  input: { mode: string; filename: string; headers: string[]; count: number },
) {
  if (
    !["upload", "update", "replace"].includes(input.mode) ||
    !Array.isArray(input.headers) ||
    !input.headers.length ||
    !Number.isSafeInteger(input.count) ||
    input.count < 1
  )
    throw new AppError("The import metadata is invalid.");
  const space = await workspace(owner);
  const refreshing = await database()
    .prepare(
      "SELECT id FROM refresh_runs WHERE owner=? AND status='running' LIMIT 1",
    )
    .bind(owner)
    .first();
  if (refreshing)
    throw new AppError(
      "Cancel the active market refresh before changing inventory.",
      409,
    );
  if (space.import_lock) {
    const old = await database()
      .prepare("SELECT created_at FROM imports WHERE id=? AND owner=?")
      .bind(space.import_lock, owner)
      .first<{ created_at: number }>();
    if (old && Date.now() - old.created_at < 1800000)
      throw new AppError(
        "An import is already in progress. Cancel it before starting another.",
        409,
      );
    await cancelImport(owner, space.import_lock);
  }
  const id = crypto.randomUUID();
  const lock = await database()
    .prepare(
      "UPDATE workspaces SET import_lock=? WHERE owner=? AND import_lock IS NULL AND NOT EXISTS (SELECT 1 FROM refresh_runs WHERE owner=? AND status='running')",
    )
    .bind(id, owner, owner)
    .run();
  if (!lock.meta.changes)
    throw new AppError("Another import has just started.", 409);
  try {
    await database()
      .prepare(
        "INSERT INTO imports (id,owner,mode,filename,headers,expected,status,created_at) VALUES (?,?,?,?,?,?,'pending',?)",
      )
      .bind(
        id,
        owner,
        input.mode,
        input.filename,
        JSON.stringify(input.headers),
        input.count,
        Date.now(),
      )
      .run();
  } catch (error) {
    await database()
      .prepare(
        "UPDATE workspaces SET import_lock=NULL WHERE owner=? AND import_lock=?",
      )
      .bind(owner, id)
      .run();
    throw error;
  }
  return { id };
}
async function importSession(owner: string, id: string) {
  const record = await database()
    .prepare("SELECT * FROM imports WHERE owner=? AND id=?")
    .bind(owner, id)
    .first<{
      id: string;
      mode: string;
      filename: string;
      headers: string;
      expected: number;
      status: string;
    }>();
  if (!record) throw new AppError("Import not found.", 404);
  return record;
}
export async function uploadChunk(
  owner: string,
  id: string,
  start: number,
  rows: ImportRow[],
) {
  const session = await importSession(owner, id);
  if (session.status !== "pending")
    throw new AppError("This import is no longer active.", 409);
  if (
    !Array.isArray(rows) ||
    rows.length > 500 ||
    !Number.isSafeInteger(start) ||
    start < 0 ||
    start + rows.length > session.expected
  )
    throw new AppError("Invalid import chunk.");
  for (const row of rows)
    if (
      !row.info?.key ||
      (!/^\d+$/.test(row.info.skuId) && !/^\d+$/.test(row.info.productId)) ||
      !Number.isSafeInteger(row.info.quantity) ||
      row.info.quantity < 0 ||
      !row.raw
    )
      throw new AppError("An inventory row is invalid.");
  const data = rows.map((row, index) => ({
    id: id + ":" + (start + index),
    rowNo: start + index,
    key: row.info.key,
    info: JSON.stringify(row.info),
    raw: JSON.stringify(row.raw),
  }));
  await database()
    .prepare(
      "INSERT INTO inventory_rows (id,owner,version,row_no,card_key,info,raw) SELECT json_extract(value,'$.id'),?,?,json_extract(value,'$.rowNo'),json_extract(value,'$.key'),json_extract(value,'$.info'),json_extract(value,'$.raw') FROM json_each(?) WHERE 1 ON CONFLICT(id) DO UPDATE SET info=excluded.info,raw=excluded.raw,card_key=excluded.card_key",
    )
    .bind(owner, id, JSON.stringify(data))
    .run();
  return { received: start + rows.length };
}
export async function cancelImport(owner: string, id: string) {
  await database().batch([
    database()
      .prepare(
        "UPDATE imports SET status='cancelled' WHERE owner=? AND id=? AND status='pending'",
      )
      .bind(owner, id),
    database()
      .prepare(
        "UPDATE workspaces SET import_lock=NULL WHERE owner=? AND import_lock=?",
      )
      .bind(owner, id),
    database()
      .prepare(
        "DELETE FROM inventory_rows WHERE owner=? AND version=? AND NOT EXISTS (SELECT 1 FROM workspaces WHERE owner=? AND active_version=?)",
      )
      .bind(owner, id, owner, id),
  ]);
  return { cancelled: true };
}
export async function commitImport(owner: string, id: string) {
  const session = await importSession(owner, id);
  if (session.status === "complete") return state(owner);
  const space = await workspace(owner);
  if (session.status !== "pending" || space.import_lock !== id)
    throw new AppError("This import is no longer active.", 409);
  const count = await database()
    .prepare(
      "SELECT COUNT(*) AS count FROM inventory_rows WHERE owner=? AND version=?",
    )
    .bind(owner, id)
    .first<{ count: number }>();
  if (count?.count !== session.expected)
    throw new AppError("The complete CSV has not been uploaded.");
  const headers =
    session.mode === "update"
      ? [
          ...new Set([
            ...JSON.parse(space.headers),
            ...JSON.parse(session.headers),
          ]),
        ]
      : JSON.parse(session.headers);
  const statements: D1PreparedStatement[] = [];
  const settings = inventoryPreferences(preferences(space), headers);
  if (session.mode === "update" && space.active_version)
    statements.push(
      database()
        .prepare(
          "INSERT INTO inventory_rows (id,owner,version,row_no,card_key,info,raw) SELECT ?||':old:'||old.row_no,old.owner,?,?+old.row_no,old.card_key,old.info,old.raw FROM inventory_rows old WHERE old.owner=? AND old.version=? AND NOT EXISTS (SELECT 1 FROM inventory_rows newer WHERE newer.owner=old.owner AND newer.version=? AND newer.card_key=old.card_key)",
        )
        .bind(id, id, session.expected, owner, space.active_version, id),
    );
  statements.push(
    database()
      .prepare(
        "INSERT INTO cards (id,owner,version,card_key,info,quantity) SELECT ?||':'||card_key,owner,version,card_key,MIN(info),SUM(CAST(json_extract(info,'$.quantity') AS REAL)) FROM inventory_rows WHERE owner=? AND version=? GROUP BY owner,version,card_key",
      )
      .bind(id, owner, id),
    database()
      .prepare(
        "UPDATE workspaces SET active_version=?,filename=?,headers=?,settings=?,imported_at=COALESCE(imported_at,?),updated_at=?,import_lock=NULL WHERE owner=? AND import_lock=?",
      )
      .bind(
        id,
        session.filename,
        JSON.stringify(headers),
        JSON.stringify(settings),
        Date.now(),
        Date.now(),
        owner,
        id,
      ),
    database()
      .prepare("UPDATE imports SET status='complete' WHERE owner=? AND id=?")
      .bind(owner, id),
  );
  if (space.active_version)
    statements.push(
      database()
        .prepare("DELETE FROM cards WHERE owner=? AND version=?")
        .bind(owner, space.active_version),
      database()
        .prepare("DELETE FROM inventory_rows WHERE owner=? AND version=?")
        .bind(owner, space.active_version),
    );
  await database().batch(statements);
  return state(owner);
}
const marketFields = columns.filter(
  (column) =>
    ![
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
      "fetchedAt",
    ].includes(column.key),
);
export function expressions(p: Preferences) {
  const result: Record<string, string> = {};
  for (const key of [
    "name",
    "number",
    "set",
    "skuId",
    "rarity",
    "condition",
    "printing",
    "language",
  ])
    result[key] = "json_extract(c.info,'$." + key + "')";
  for (const column of marketFields)
    result[column.key] = "json_extract(m.data,'$." + column.key + "')";
  result.productId =
    "COALESCE(NULLIF(json_extract(c.info,'$.productId'),''),m.product_id,json_extract((SELECT data FROM api_cache WHERE id=c.owner||'|sku-map:'||json_extract(c.info,'$.skuId')),'$.productId'))";
  result.quantity = "c.quantity";
  result.fetchedAt = "m.fetched_at";
  const velocity =
    "MIN(100,MAX(0," + result.dailySales + "/" + p.velocityTarget + "*100))";
  result.velocityScore =
    "CASE WHEN " + result.dailySales + " IS NOT NULL THEN " + velocity + " END";
  result.demandScore =
    "CASE WHEN " +
    result.dailySales +
    " IS NOT NULL THEN (" +
    velocity +
    "+MIN(100,MAX(0,50+COALESCE(" +
    result.salesTrend +
    ",0)/2)))/2 END";
  result.competitionScore =
    "CASE WHEN " +
    result.sampleSellers +
    " IS NOT NULL THEN MIN(100," +
    result.sampleSellers +
    "*5) END";
  result.recommendedPrice =
    "CASE WHEN " +
    result.marketPrice +
    " IS NOT NULL OR " +
    result.listingLow +
    " IS NOT NULL THEN MAX(" +
    p.minimumPrice +
    ",COALESCE(" +
    result.listingLow +
    "," +
    result.marketPrice +
    ")) END";
  result.netProceeds =
    "(" +
    result.recommendedPrice +
    "*(1-" +
    p.feePercent +
    "/100.0)-" +
    p.fixedFee +
    "-" +
    p.shipping +
    ")";
  result.inventoryValue = "(" + result.marketPrice + "*c.quantity)";
  const profit = "MIN(100,MAX(0," + result.netProceeds + "*10))",
    denominator = p.velocityWeight + p.demandWeight + p.profitWeight;
  result.priority =
    denominator > 0
      ? "CASE WHEN " +
        result.netProceeds +
        " <= 0 THEN 0 WHEN " +
        result.dailySales +
        " IS NOT NULL AND " +
        result.netProceeds +
        " IS NOT NULL THEN MAX(0,MIN(100,(" +
        result.velocityScore +
        "*" +
        p.velocityWeight +
        "+" +
        result.demandScore +
        "*" +
        p.demandWeight +
        "+" +
        profit +
        "*" +
        p.profitWeight +
        ")/" +
        denominator +
        ")) END"
      : "NULL";
  return result;
}
export type QueryInput = {
  filters?: Filters;
  sort?: string;
  direction?: string;
  page?: number;
  pageSize?: number;
  selected?: string[];
};
export function buildQuery(owner: string, space: Workspace, input: QueryInput) {
  const p = preferences(space),
    e = expressions(p),
    f = input.filters;
  const headers: string[] = JSON.parse(space.headers);
  const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
  for (const header of headers)
    e[csvColumnKey(header)] = "(SELECT value FROM json_each(r.raw) WHERE key='" + header.replaceAll("'", "''") + "')";
  e.rowNo = "r.row_no";
  const values: unknown[] = [owner, space.active_version ?? ""],
    where = ["c.owner=?", "c.version=?"];
  if (f?.search?.trim()) {
    const search = "%" + f.search.trim().replace(/[\\%_]/g, "\\$&") + "%";
    where.push(
      "(" +
        ["name", "number", "set", "productId", "skuId"]
          .map((key) => e[key] + " LIKE ? ESCAPE '\\'")
          .join(" OR ") + " OR EXISTS (SELECT 1 FROM json_each(r.raw) WHERE CAST(value AS TEXT) LIKE ? ESCAPE '\\')" +
        ")",
    );
    values.push(search, search, search, search, search, search);
  }
  for (const [key, list] of Object.entries(f?.categories ?? {}))
    if (
      ["condition", "printing", "language", "set", "rarity"].includes(key) &&
      Array.isArray(list) &&
      list.length
    ) {
      where.push(e[key] + " IN (SELECT value FROM json_each(?))");
      values.push(JSON.stringify(list));
    }
  for (const filter of f?.numeric ?? []) {
    if (
      !columns.some(
        (column) =>
          column.key === filter.field &&
          ["number", "money", "percent", "score"].includes(column.kind),
      )
    )
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
      "m.fetched_at>=? AND COALESCE(json_extract(m.data,'$.partial'),0)=0",
    );
    values.push(Date.now() - p.staleHours * 3600000);
  }
  if (f?.freshness === "outdated") {
    where.push("(m.fetched_at<? OR json_extract(m.data,'$.partial')=1)");
    values.push(Date.now() - p.staleHours * 3600000);
  }
  if (["lastSoldAt", "fetchedAt"].includes(f?.dateField ?? "")) {
    if (f?.dateFrom && Number.isFinite(Date.parse(f.dateFrom))) {
      where.push(e[f.dateField] + ">=?");
      values.push(Date.parse(f.dateFrom));
    }
    if (f?.dateTo && Number.isFinite(Date.parse(f.dateTo))) {
      where.push(e[f.dateField] + "<?");
      values.push(Date.parse(f.dateTo) + 86400000);
    }
  }
  if (input.selected?.length) {
    where.push("c.card_key IN (SELECT value FROM json_each(?))");
    values.push(JSON.stringify(input.selected));
  }
  const sort = e[input.sort ?? "rowNo"]
      ? (input.sort ?? "rowNo")
      : "rowNo",
    direction = input.direction === "asc" ? "ASC" : "DESC";
  const select = [...columns, ...inventoryColumns(headers).filter(column => column.key.startsWith("csv:"))]
    .map((column) => e[column.key] + ' AS ' + quote(column.key))
    .join(",");
  const order =
    e[sort] + " IS NULL," + e[sort] + ' ' + direction + ",c.card_key ASC";
  const limit = f?.limit === 50 || f?.limit === 100 ? f.limit : 0;
  const sql =
    "SELECT c.card_key AS key," +
    select +
    // Pin the card lookup index: SQLite otherwise favors row order and scans
    // the entire inventory once per card on large imports.
    ",r.row_no AS rowNo,json_extract(m.data,'$.granularity') AS granularity,json_extract(m.data,'$.lowerBound') AS lowerBound,COALESCE(json_extract(m.data,'$.analyzed'),json_extract(m.data,'$.available'),0) AS analyzed,json_extract(m.data,'$.partial') AS partial,json_extract(m.data,'$.available') AS available FROM cards c LEFT JOIN market m ON m.owner=c.owner AND m.card_key=c.card_key LEFT JOIN inventory_rows r ON r.id=(SELECT id FROM inventory_rows INDEXED BY rows_card WHERE owner=c.owner AND version=c.version AND card_key=c.card_key ORDER BY row_no LIMIT 1) WHERE " +
    where.join(" AND ") +
    " ORDER BY " +
    order +
    (limit ? " LIMIT " + limit : "");
  return { sql, values, e };
}
export async function queryCards(owner: string, input: QueryInput) {
  const space = await workspace(owner),
    query = buildQuery(owner, space, input),
    db = database();
  const page = Math.max(1, Math.floor(Number(input.page) || 1)),
    pageSize = [25, 50, 100].includes(Number(input.pageSize))
      ? Number(input.pageSize)
      : 50;
  const total = await db
    .prepare(
      "WITH result AS (" +
        query.sql +
        ") SELECT COUNT(*) AS matches,COALESCE(SUM(quantity),0) AS units,SUM(inventoryValue) AS value,COUNT(marketPrice) AS priced,MAX(fetchedAt) AS lastRefreshed FROM result",
    )
    .bind(...query.values)
    .first();
  const rows = await db
    .prepare("SELECT * FROM (" + query.sql + ") LIMIT ? OFFSET ?")
    .bind(...query.values, pageSize, (page - 1) * pageSize)
    .all();
  return { rows: rows.results, page, pageSize, ...total };
}
export async function facets(owner: string) {
  const space = await workspace(owner),
    result: Record<string, string[]> = {};
  for (const field of ["set", "condition", "printing", "language", "rarity"]) {
    const rows = await database()
      .prepare(
        "SELECT DISTINCT json_extract(info,'$." +
          field +
          "') AS value FROM cards WHERE owner=? AND version=? AND json_extract(info,'$." +
          field +
          "')<>'' ORDER BY value",
      )
      .bind(owner, space.active_version ?? "")
      .all<{ value: string }>();
    result[field] = rows.results.map((row) => row.value);
  }
  return result;
}
export async function exportInventory(
  owner: string,
  input: QueryInput & { analysis?: boolean },
) {
  const space = await workspace(owner),
    query = buildQuery(owner, space, input),
    exportColumns = inventoryColumns(JSON.parse(space.headers)),
    headers = input.analysis
      ? exportColumns.map((column) => column.label)
      : JSON.parse(space.headers);
  const encoder = new TextEncoder(),
    db = database();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(
          encoder.encode("\uFEFF" + headers.map(csvCell).join(",") + "\r\n"),
        );
        let offset = 0;
        for (;;) {
          const sql = input.analysis
            ? "SELECT * FROM (" + query.sql + ") LIMIT 500 OFFSET ?"
            : "SELECT r.raw FROM inventory_rows r WHERE r.owner=? AND r.version=? AND r.card_key IN (SELECT key FROM (" +
              query.sql +
              ")) ORDER BY r.row_no LIMIT 500 OFFSET ?";
          const args = input.analysis
            ? [...query.values, offset]
            : [owner, space.active_version ?? "", ...query.values, offset];
          const rows = await db
            .prepare(sql)
            .bind(...args)
            .all<Record<string, unknown>>();
          if (!rows.results.length) break;
          const lines =
            rows.results
              .map((row) => {
                if (input.analysis)
                  return exportColumns
                    .map((column) => csvCell(row[column.key]))
                    .join(",");
                const original = JSON.parse(String(row.raw));
                return headers
                  .map((header: string) => csvCell(original[header] ?? ""))
                  .join(",");
              })
              .join("\r\n") + "\r\n";
          controller.enqueue(encoder.encode(lines));
          offset += rows.results.length;
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition":
        'attachment; filename="' +
        (input.analysis ? "market-analysis" : "tcgplayer-inventory") +
        '.csv"',
      "Cache-Control": "no-store",
    },
  });
}
