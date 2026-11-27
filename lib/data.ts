import { env } from "cloudflare:workers";
import {
  columns,
  inventoryColumns,
  inventoryPreferences,
  csvColumnKey,
  isCategoryValue,
  isNumericFilterColumn,
  isTagsColumn,
  legacyCategoryColumns,
  type CategoryValue,
  normalizePreferences,
  emptyFilters,
  type Preferences,
  type Filters,
  type ImportRow,
} from "./domain";
import { csvCell, csvInfoField, csvQuantity, mapColumns, productIdFrom } from "./csv";

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
  const db = database();
  const query = db.prepare("SELECT * FROM workspaces WHERE owner=?").bind(owner);
  const existing = await query.first<Workspace>();
  if (existing) return existing;
  await db.prepare("INSERT OR IGNORE INTO workspaces (owner) VALUES (?)").bind(owner).run();
  return (await query.first<Workspace>())!;
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
  const refresh = await db
    .prepare(
      "SELECT id,status,started_at,completed,failed,total,spent FROM refresh_runs WHERE owner=? ORDER BY started_at DESC LIMIT 1",
    )
    .bind(owner)
    .first();
  const coverage = await db.prepare(`SELECT COUNT(*) AS uniqueCards, COALESCE(SUM(c.quantity),0) AS totalCards,
    MIN(json_extract(m.data,'$.historyFrom')) AS historyFrom, MAX(json_extract(m.data,'$.historyTo')) AS historyTo,
    COUNT(DISTINCT COALESCE(NULLIF(json_extract(c.info,'$.productId'),''),m.product_id,json_extract(a.data,'$.productId'))) AS uniqueProducts,
    COUNT(DISTINCT CASE WHEN COALESCE(json_extract(m.data,'$.analyzed'),json_extract(m.data,'$.available'),0)=1 THEN COALESCE(NULLIF(json_extract(c.info,'$.productId'),''),m.product_id,json_extract(a.data,'$.productId')) END) AS analyzedProducts,
    COUNT(DISTINCT CASE WHEN COALESCE(NULLIF(json_extract(c.info,'$.productId'),''),m.product_id,json_extract(a.data,'$.productId')) IS NULL THEN COALESCE(NULLIF(json_extract(c.info,'$.skuId'),''),c.card_key) END) AS unresolvedProducts
    FROM cards c LEFT JOIN market m ON m.owner=c.owner AND m.card_key=c.card_key LEFT JOIN api_cache a ON a.id=c.owner||'|sku-map:'||json_extract(c.info,'$.skuId') WHERE c.owner=? AND c.version=?`).bind(owner,space.active_version??"").first<any>();
  return {
    ...coverage,
    version: space.active_version ?? "",
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
    refresh,
  };
}
export async function savePreferences(
  owner: string,
  input: { settings?: Partial<Preferences>; key?: string; clearKey?: boolean; settingsOnly?: boolean },
) {
  const space = await workspace(owner);
  const settings = normalizePreferences({
    ...preferences(space),
    ...input.settings,
  });
  if (input.key) throw new AppError("Configure API_SH_API_KEY on the backend; API keys are not accepted by this page.");
  // Replace only the requested fields atomically. A view save must not erase a
  // simultaneous column/theme change from this device or another device.
  const keys = Object.keys(input.settings ?? {}).filter(key => Object.hasOwn(settings,key)) as (keyof Preferences)[];
  const args = keys.flatMap(key => ["$." + key, JSON.stringify(settings[key])]);
  const expression = keys.length ? "json_set(settings," + keys.map(() => "?,json(?)").join(",") + ")" : "settings";
  const saved = await database()
    .prepare("UPDATE workspaces SET settings=" + expression + ",secret=CASE WHEN ? THEN '' ELSE secret END WHERE owner=? RETURNING *")
    .bind(...args, input.clearKey ? 1 : 0, owner)
    .first<Workspace>();
  if (input.settingsOnly) return {settings:preferences(saved!)};
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
  const headers = new Set<string>(JSON.parse(session.headers));
  for (const row of rows)
    if (
      !row.info?.key ||
      (!/^\d+$/.test(row.info.skuId) && !/^\d+$/.test(row.info.productId)) ||
      !Number.isSafeInteger(row.info.quantity) ||
      row.info.quantity < 0 ||
      !row.raw ||
      (row.info.quantityColumn !== undefined && row.info.quantityColumn !== "" &&
        (!headers.has(row.info.quantityColumn) || typeof row.raw[row.info.quantityColumn] !== "string"))
    )
      throw new AppError("An inventory row is invalid.");
  const data = rows.map((row, index) => {
    const productId = /^\d+$/.test(row.info.productId) ? productIdFrom(String(row.info.productId)) : "";
    const skuId = /^\d+$/.test(row.info.skuId) ? String(row.info.skuId).replace(/^0+(?=\d)/, "") : "";
    const key = productId ? "product:" + productId + "|row:0" : "sku:" + skuId;
    const source = row.info.quantityColumn;
    const quantity = source === undefined ? row.info.quantity : csvQuantity(source ? row.raw[source] : "");
    return {id: id + ":" + (start + index), rowNo: start + index, key,
      info: JSON.stringify({...row.info, productId, skuId, key, quantity}), raw: JSON.stringify(row.raw)};
  });
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
export async function commitImport(owner: string, id: string, lightweight = false, productIdColumn?: string) {
  const session = await importSession(owner, id);
  if (session.status === "complete") return lightweight ? {saved:true} : state(owner);
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
  const uploadedHeaders: string[] = JSON.parse(session.headers);
  if (productIdColumn !== undefined && !uploadedHeaders.includes(productIdColumn))
    throw new AppError("Choose the column containing TCGplayer Product IDs.");
  const headers =
    session.mode === "update"
      ? [
          ...new Set([
            ...JSON.parse(space.headers),
            ...uploadedHeaders,
          ]),
        ]
      : uploadedHeaders;
  const statements: D1PreparedStatement[] = [];
  const settings = inventoryPreferences(preferences(space), headers);
  if (productIdColumn !== undefined) settings.productIdColumn = productIdColumn;
  const canonicalId = (alias: string, field: string) => "COALESCE(NULLIF(LTRIM(json_extract("+alias+".info,'$."+field+"'),'0'),''),'0')";
  const identity = (alias: string) => "CASE WHEN COALESCE(json_extract("+alias+".info,'$.productId'),'')<>'' THEN 'product:'||"+canonicalId(alias,"productId")+"||'|row:0' ELSE 'sku:'||"+canonicalId(alias,"skuId")+" END";
  if (session.mode === "update" && space.active_version)
    statements.push(
      database()
        .prepare(
          "INSERT INTO inventory_rows (id,owner,version,row_no,card_key,info,raw) SELECT ?||':old:'||old.row_no,old.owner,?,?+old.row_no,old.card_key,old.info,old.raw FROM inventory_rows old WHERE old.owner=? AND old.version=? AND NOT EXISTS (SELECT 1 FROM inventory_rows newer INDEXED BY rows_card WHERE newer.owner=old.owner AND newer.version=? AND newer.card_key="+identity("old")+")",
        )
        .bind(id, id, session.expected, owner, space.active_version, id),
    );
  statements.push(
    // Validate the complete upload first, then deduplicate the staged version
    // atomically. This also covers old clients and duplicates across chunks.
    database().prepare("DELETE FROM inventory_rows WHERE owner=? AND version=? AND row_no NOT IN (SELECT MIN(r.row_no) FROM inventory_rows r WHERE r.owner=? AND r.version=? GROUP BY "+identity("r")+")").bind(owner,id,owner,id),
    database()
      .prepare(
        "INSERT INTO cards (id,owner,version,card_key,info,quantity) SELECT ?||':'||card_key,owner,version,card_key,MIN(info),SUM(CAST(json_extract(info,'$.quantity') AS REAL)) FROM inventory_rows WHERE owner=? AND version=? GROUP BY owner,version,card_key",
      )
      .bind(id, owner, id),
    // Earlier imports could save product history under numbered duplicate keys.
    // Keep those archives and restore product-level history to the canonical key.
    database().prepare(`INSERT INTO market (id,owner,card_key,product_id,fetched_at,data,detail)
      SELECT c.owner||'|'||c.card_key,c.owner,c.card_key,saved.product_id,saved.fetched_at,saved.data,saved.detail
      FROM cards c JOIN market saved ON saved.id=(
        SELECT old.id FROM market old
        WHERE old.owner=c.owner AND old.product_id=json_extract(c.info,'$.productId')
          AND old.card_key GLOB 'product:*|row:*'
          AND COALESCE(json_extract(old.data,'$.available'),0)=1
        ORDER BY old.fetched_at DESC,old.card_key LIMIT 1
      )
      WHERE c.owner=? AND c.version=?
        AND c.card_key='product:'||json_extract(c.info,'$.productId')||'|row:0'
        AND NOT EXISTS (SELECT 1 FROM market m WHERE m.owner=c.owner AND m.card_key=c.card_key)`
    ).bind(owner,id),
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
  if (session.mode === "update" && space.active_version)
    statements.push(database().prepare("INSERT INTO inventory_sync(owner,version,previous_version,uploaded) VALUES (?,?,?,?)")
      .bind(owner,id,space.active_version,session.expected));
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
  return lightweight ? {saved:true} : state(owner);
}

type InventorySelection = { version: string; keys: string[] };

function selectedInventoryKeys(input: InventorySelection) {
  if (!Array.isArray(input?.keys) || !input.keys.length ||
      input.keys.some(key => typeof key !== "string" || !key))
    throw new AppError("Select at least one inventory row.");
  if (typeof input.version !== "string" || !input.version)
    throw new AppError("Inventory changed. Reload and try again.",409);
  return [...new Set(input.keys)];
}

function guardInventoryMutation(owner: string, version: string, selected: string) {
  // The following statements check changes() inside the same transaction.
  // A stale selection or a concurrent import must leave every row untouched.
  return database().prepare(`UPDATE workspaces SET updated_at=MAX(COALESCE(updated_at,0)+1,?)
    WHERE owner=? AND active_version=? AND import_lock IS NULL
      AND NOT EXISTS (SELECT 1 FROM refresh_runs WHERE owner=workspaces.owner AND status='running')
      AND NOT EXISTS (
        SELECT 1 FROM json_each(?) wanted WHERE NOT EXISTS (
          SELECT 1 FROM cards WHERE owner=workspaces.owner AND version=workspaces.active_version AND card_key=wanted.value
        )
      )`).bind(Date.now(), owner, version, selected);
}

function inventoryChangeEvents(owner: string, subjects: string) {
  return database().prepare(`INSERT INTO sync_events(owner,kind,subject)
    SELECT ?,'inventory',value FROM json_each(?) WHERE changes()>0`).bind(owner, subjects);
}

export async function editInventory(owner: string, input: InventorySelection & { column: string; value: string }) {
  const keys = selectedInventoryKeys(input);
  if (typeof input.column !== "string" || typeof input.value !== "string" || input.value.includes("\0"))
    throw new AppError("Enter a valid CSV cell value.");
  const space = await workspace(owner);
  if (!space.active_version || space.active_version !== input.version)
    throw new AppError("Inventory changed. Reload before editing these rows.", 409);
  const headers: string[] = JSON.parse(space.headers);
  const {column, value, version} = input;
  if (!headers.includes(column)) throw new AppError("Choose a column from the current CSV.");
  const defaults = mapColumns(headers);
  const savedColumn = preferences(space).productIdColumn;
  const idColumn = savedColumn && headers.includes(savedColumn) ? savedColumn : defaults.productId;
  const changeProduct = column === idColumn;
  const productId = changeProduct ? productIdFrom(value) : "";
  if (changeProduct && (keys.length !== 1 || !productId))
    throw new AppError("A Product ID must be a number or a TCGplayer product link. Edit Product IDs one row at a time.");
  const newKey = changeProduct ? "product:" + productId + "|row:0" : null;
  const field = changeProduct ? undefined : csvInfoField(headers, column);
  const baseArgs = changeProduct ? [productId, newKey] : field ? ["$." + field, value.trim()] : [];
  const fieldValue = field === "name" ? "COALESCE(NULLIF(?,''),'Product '||json_extract(info,'$.productId'))" : "?";
  const baseInfo = changeProduct ? "json_set(info,'$.productId',?,'$.key',?)"
    : field ? "json_set(info,?," + fieldValue + ")" : "info";
  const quantityMatches = "COALESCE(json_extract(info,'$.quantityColumn'),?)=?";
  const quantityColumnArgs = [defaults.quantity ?? "",column];
  const quantity = csvQuantity(value);
  const info = changeProduct ? baseInfo :
    `CASE WHEN ${quantityMatches} THEN json_set(${baseInfo},'$.quantity',?) ELSE ${baseInfo} END`;
  const infoArgs = changeProduct ? baseArgs : [...quantityColumnArgs,...baseArgs,quantity,...baseArgs];
  const selected = JSON.stringify(keys);
  const path = "$." + JSON.stringify(column);
  const db = database();
  const statements = [
    guardInventoryMutation(owner,version,selected),
    db.prepare(`UPDATE inventory_rows SET raw=json_set(raw,?,?),info=${info}${newKey ? ",card_key=?" : ""}
      WHERE owner=? AND version=? AND card_key IN (SELECT value FROM json_each(?))
        AND changes()>0 AND (json_extract(raw,?) IS NOT ?${newKey ? " OR card_key<>?" : ""})`)
      .bind(path, value, ...infoArgs, ...(newKey ? [newKey] : []), owner, version, selected, path, value, ...(newKey ? [newKey] : [])),
  ];
  const subjects = newKey && newKey !== keys[0] ? [...keys, newKey] : keys;
  statements.push(inventoryChangeEvents(owner,JSON.stringify(subjects)));
  statements.push(
    db.prepare(`UPDATE cards SET info=${info},${newKey ? "card_key=?" : "quantity=CASE WHEN " + quantityMatches + " THEN ? ELSE quantity END"}
      WHERE owner=? AND version=? AND card_key IN (SELECT value FROM json_each(?)) AND changes()>0
      ${field || newKey ? "" : "AND " + quantityMatches}`)
      .bind(...infoArgs, ...(newKey ? [newKey] : [...quantityColumnArgs,quantity]), owner, version, selected,
        ...(field || newKey ? [] : quantityColumnArgs)),
  );
  try {
    const [guard, edits] = await db.batch(statements);
    if (!guard.meta.changes)
      throw new AppError("Inventory is busy or the selected rows changed. Reload and try again.", 409);
    return {changed: edits.meta.changes ?? 0, newKey};
  } catch (error) {
    if (newKey && /UNIQUE constraint failed: cards\.owner, cards\.version, cards\.card_key/i.test(String(error)))
      throw new AppError("That Product ID is already in the inventory.", 409);
    throw error;
  }
}

export async function deleteInventory(owner: string, input: InventorySelection) {
  const selected = JSON.stringify(selectedInventoryKeys(input));
  const {version} = input;
  const db = database();
  // Sales are stored separately by product and can be used if a card returns.
  const [guard, deleted] = await db.batch([
    guardInventoryMutation(owner,version,selected),
    db.prepare(`DELETE FROM cards WHERE owner=? AND version=?
      AND card_key IN (SELECT value FROM json_each(?)) AND changes()>0`).bind(owner,version,selected),
    inventoryChangeEvents(owner,selected),
    db.prepare(`DELETE FROM inventory_rows WHERE owner=? AND version=?
      AND card_key IN (SELECT value FROM json_each(?)) AND changes()>0`).bind(owner,version,selected),
  ]);
  if (!guard.meta.changes)
    throw new AppError("Inventory is busy or the selected rows changed. Reload and try again.",409);
  return {deleted: deleted.meta.changes ?? 0};
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
export const productIdExpression = "COALESCE(NULLIF(json_extract(c.info,'$.productId'),''),m.product_id,json_extract((SELECT data FROM api_cache WHERE id=c.owner||'|sku-map:'||json_extract(c.info,'$.skuId')),'$.productId'))";

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
  result.productId = productIdExpression;
  result.quantity = "c.quantity";
  result.fetchedAt = "m.fetched_at";
  result.unitsSold = "COALESCE(json_extract(m.data,'$.unitsSold'),(SELECT CASE WHEN COUNT(*)=0 OR SUM(CASE WHEN json_extract(h.value,'$.units') IS NULL OR json_extract(h.value,'$.units')<0 THEN 1 ELSE 0 END)>0 THEN NULL ELSE SUM(json_extract(h.value,'$.units')) END FROM json_each(m.detail,'$.history') h))";
  result.historyFrom = "COALESCE(json_extract(m.data,'$.historyFrom'),(SELECT MIN(json_extract(h.value,'$.date')) FROM json_each(m.detail,'$.history') h))";
  result.historyTo = "COALESCE(json_extract(m.data,'$.historyTo'),(SELECT MAX(json_extract(h.value,'$.date')) FROM json_each(m.detail,'$.history') h))";
  return result;
}
// Match JavaScript trim for space-only CSV cells, including spreadsheet whitespace.
const sqlWhitespace = "char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)";

function csvNumberExpression(expression: string) {
  const value = "TRIM(REPLACE(REPLACE(CAST("+expression+" AS TEXT),'$',''),',',''),"+sqlWhitespace+")";
  return "(SELECT CASE WHEN magnitude GLOB '*[0-9]*' AND magnitude NOT GLOB '*[^0-9.]*' " +
    "AND magnitude NOT GLOB '*.*.*' AND ABS(CAST(number AS REAL)) <= 1.7976931348623157e308 " +
    "THEN CAST(number AS REAL) END FROM (SELECT number, CASE WHEN SUBSTR(number,1,1) IN ('+','-') " +
    "THEN SUBSTR(number,2) ELSE number END AS magnitude FROM (SELECT "+value+" AS number)))";
}

export type QueryInput = {
  filters?: Filters;
  sort?: string;
  direction?: string;
  page?: number;
  pageSize?: number;
  selected?: string[];
  displayColumns?: string[];
};
export function buildQuery(owner: string, space: Workspace, input: QueryInput, forCount = false, fields?: readonly string[] | "table") {
  const p = preferences(space),
    e = expressions(p),
    f = input.filters;
  const headers: string[] = JSON.parse(space.headers);
  const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
  for (const header of headers)
    e[csvColumnKey(header)] = "json_extract(r.raw,'$." + JSON.stringify(header).replaceAll("'", "''") + "')";
  e.rowNo = "r.row_no";
  const from = f?.dateFrom ? Date.parse(f.dateFrom) : null, to = f?.dateTo ? Date.parse(f.dateTo) : null;
  if ((from !== null && !Number.isFinite(from)) || (to !== null && !Number.isFinite(to)) || (from !== null && to !== null && from > to)) throw new AppError("Choose a valid sales date range with the start before the end.");
  if (from !== null || to !== null) {
    const dates = [from !== null ? "json_extract(h.value,'$.date')>="+from : "1", to !== null ? "json_extract(h.value,'$.date')<"+(to+86400000) : "1"].join(" AND ");
    e.unitsSold = "(SELECT CASE WHEN COUNT(*)=0 OR SUM(CASE WHEN json_extract(h.value,'$.units') IS NULL OR json_extract(h.value,'$.units')<0 THEN 1 ELSE 0 END)>0 THEN NULL ELSE SUM(json_extract(h.value,'$.units')) END FROM json_each(m.detail,'$.history') h WHERE "+dates+")";
  }
  const start = from ?? e.historyFrom, end = to ?? e.historyTo;
  e.avgDailySold = `CASE WHEN ${end}>=${start} THEN 1.0*(${e.unitsSold})/((${end}-${start})/86400000.0+1) END`;

  const values: unknown[] = [owner, space.active_version ?? ""],
    where = ["c.owner=?", "c.version=?"];
  if (Array.isArray(input.displayColumns)) {
    const displayed = [...new Set(input.displayColumns)].filter(key=>key!=="rowNo" && Object.hasOwn(e,key));
    const hasValue = (expression: string) =>
      "UPPER(COALESCE(TRIM(CAST("+expression+" AS TEXT),"+sqlWhitespace+"),'')) NOT IN ('','N/A')";
    const checks = displayed.filter(key=>!key.startsWith("csv:") || displayed.length<=64).map(key=>hasValue(e[key]));
    const csvHeaders = displayed.length>64 ? displayed.filter(key=>key.startsWith("csv:")).map(key=>key.slice(4)) : [];
    if (csvHeaders.length) {
      checks.unshift("EXISTS (SELECT 1 FROM json_each(r.raw) cell WHERE cell.key IN (SELECT value FROM json_each(?)) AND "+hasValue("cell.value")+")");
      values.push(JSON.stringify(csvHeaders));
    }
    if (checks.length) where.push("(" + checks.join(" OR ") + ")");
  }
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
  for (const [key, list] of Object.entries(f?.categories ?? {})) {
    if (!Object.hasOwn(e,key) || key === "rowNo" || !Array.isArray(list)) continue;
    const choices = list.filter(isCategoryValue);
    const clauses: string[] = [];
    if (choices.length) {
      clauses.push(e[key] + " IN (SELECT value FROM json_each(?))");
      values.push(JSON.stringify(choices));
    }
    if (isTagsColumn(key) && list.includes(""))
      clauses.push("COALESCE(TRIM(" + e[key] + "," + sqlWhitespace + "),'')=''");
    if (clauses.length) where.push("(" + clauses.join(" OR ") + ")");
  }
  for (const filter of f?.numeric ?? []) {
    if (!Object.hasOwn(e,filter.field) || !isNumericFilterColumn(filter.field)) continue;
    const expression = filter.field.startsWith("csv:") ? csvNumberExpression(e[filter.field]) : e[filter.field];
    if (filter.min !== "" && Number.isFinite(Number(filter.min))) {
      where.push(expression + ">=?");
      values.push(Number(filter.min));
    }
    if (filter.max !== "" && Number.isFinite(Number(filter.max))) {
      where.push(expression + "<=?");
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
  if (input.selected?.length) {
    where.push("c.card_key IN (SELECT value FROM json_each(?))");
    values.push(JSON.stringify(input.selected));
  }
  const sort = e[input.sort ?? "rowNo"]
      ? (input.sort ?? "rowNo")
      : "rowNo",
    direction = input.direction === "asc" ? "ASC" : "DESC";
  const output: Record<string,string> = {
    ...e,
    granularity: "json_extract(m.data,'$.granularity')",
    historyRange: "json_extract(m.data,'$.historyRange')",
    lowerBound: "json_extract(m.data,'$.lowerBound')",
    analyzed: "COALESCE(json_extract(m.data,'$.analyzed'),json_extract(m.data,'$.available'),0)",
    partial: "json_extract(m.data,'$.partial')",
    available: "json_extract(m.data,'$.available')",
  };
  const projected = fields === "table"
    ? Object.keys(output).filter(key => key !== "avgDailySold" || !input.displayColumns || input.displayColumns.includes(key))
    : fields ?? Object.keys(output);
  const select = ["c.card_key AS key", ...projected
    .map((key) => output[key] + ' AS ' + quote(key))].join(",");
  const order = e[sort] + " " + direction + " NULLS LAST,c.card_key ASC";
  const limit = f?.limit === 50 || f?.limit === 100 ? f.limit : 0;
  const sql =
    "SELECT " +
    select +
    // Pin the card lookup index: SQLite otherwise favors row order and scans
    // the entire inventory once per card on large imports.
    " FROM cards c LEFT JOIN market m ON m.owner=c.owner AND m.card_key=c.card_key LEFT JOIN inventory_rows r ON r.id=(SELECT id FROM inventory_rows INDEXED BY rows_card WHERE owner=c.owner AND version=c.version AND card_key=c.card_key ORDER BY row_no LIMIT 1) WHERE " +
    where.join(" AND ") +
    (forCount && !limit ? "" : " ORDER BY " + order) +
    (limit ? " LIMIT " + limit : "");
  return { sql, values, e };
}
export async function queryCards(owner: string, input: QueryInput) {
  const space = await workspace(owner),
    query = buildQuery(owner, space, input, false, "table"),
    db = database();
  const requested = Math.max(1, Math.floor(Number(input.page) || 1)),
    pageSize = [25, 50, 100].includes(Number(input.pageSize))
      ? Number(input.pageSize)
      : 50;
  const countQuery = buildQuery(owner,space,input,true,["quantity","fetchedAt"]);
  const total = await db
    .prepare(
      "WITH result AS (" +
        countQuery.sql +
        ") SELECT COUNT(*) AS matches,COALESCE(SUM(quantity),0) AS units,NULL AS value,0 AS priced,MAX(fetchedAt) AS lastRefreshed FROM result",
    )
    .bind(...countQuery.values)
    .first();
  const page = input.displayColumns?.length ? Math.min(requested,Math.max(1,Math.ceil(Number(total?.matches??0)/pageSize))) : requested;
  const rows = await db
    .prepare("SELECT * FROM (" + query.sql + ") LIMIT ? OFFSET ?")
    .bind(...query.values, pageSize, (page - 1) * pageSize)
    .all();
  return { rows: rows.results, page, pageSize, ...total };
}
export async function facets(owner: string, input?: {keys: string[]; dateFrom: string; dateTo: string}) {
  const space = await workspace(owner);
  const keys = input?.keys ?? [...legacyCategoryColumns];
  const headers: string[] = JSON.parse(space.headers);
  const allowed = new Set([...columns, ...inventoryColumns(headers)].map(column=>column.key));
  const selected = [...new Set(keys)].filter(key=>allowed.has(key));
  if (!selected.length) return {};
  const query = buildQuery(owner,space,{
    filters:{...emptyFilters,dateFrom:input?.dateFrom ?? "",dateTo:input?.dateTo ?? ""},
  },true,selected);
  const identifier = (key: string) => '"' + key.replaceAll('"','""') + '"';
  const aggregates = selected.map(key => {
    const column = identifier(key);
    return "json_group_array(DISTINCT " + column + ") FILTER (WHERE " + column + " IS NOT NULL) AS " + column;
  }).join(",");
  const row = await database().prepare("SELECT "+aggregates+" FROM ("+query.sql+")").bind(...query.values)
    .first<Record<string,string>>();
  return Object.fromEntries(selected.map(key=>[
    key,
    (JSON.parse(row?.[key] ?? "[]") as unknown[]).filter(isCategoryValue).sort((a,b) =>
      typeof a === "number" && typeof b === "number" ? a-b : String(a).localeCompare(String(b))),
  ])) as Record<string,CategoryValue[]>;
}
export async function exportInventory(
  owner: string,
  input: QueryInput & { analysis?: boolean },
) {
  const space = await workspace(owner),
    query = buildQuery(owner, space, input, false, input.analysis ? undefined : []),
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
