import { AppError, apiKey, database, preferences, workspace } from "./data";

const PAGE_SIZE = 200;

export async function limitOperation(owner: string, action: string, max: number, intervalMs: number) {
  const window = Math.floor(Date.now() / intervalMs);
  const accepted = await database().prepare(
    "INSERT INTO resource_windows(owner,action,window,used) VALUES (?,?,?,1) " +
    "ON CONFLICT(owner,action) DO UPDATE SET window=excluded.window,used=CASE WHEN resource_windows.window=excluded.window THEN used+1 ELSE 1 END " +
    "WHERE resource_windows.window<excluded.window OR (resource_windows.window=excluded.window AND used<?) RETURNING used"
  ).bind(owner,action,window,max).first<number>("used");
  if (accepted === null) {
    const retry = intervalMs >= 86_400_000 ? "Try again after the daily UTC reset." : "Wait a moment and try again.";
    throw new AppError("This operation reached its usage limit. "+retry+" Saved inventory is still available.",429);
  }
}

export async function syncMetadata(owner: string, previous: string | null) {
  const db = database();
  const space = await workspace(owner);
  const version = space.active_version ?? "";
  const results = await db.batch<Record<string,unknown>>([
    db.prepare("SELECT seq FROM sync_events WHERE owner=? ORDER BY seq DESC LIMIT 1").bind(owner),
    db.prepare("SELECT id,status,started_at,completed,failed,total,spent FROM refresh_runs WHERE owner=? ORDER BY started_at DESC LIMIT 1").bind(owner),
  ]);
  const patch = previous && previous !== version ? await db.prepare(
    "WITH RECURSIVE chain(version,uploaded,depth) AS (" +
    "SELECT ?,0,0 UNION ALL SELECT i.previous_version,c.uploaded+i.uploaded,c.depth+1 " +
    "FROM chain c JOIN inventory_sync i ON i.owner=? AND i.version=c.version WHERE c.depth<64 AND c.version<>?) " +
    "SELECT uploaded FROM chain WHERE version=? LIMIT 1"
  ).bind(version,owner,previous,previous).first<number>("uploaded") : null;
  const connected = !!(await apiKey(space).catch(() => null));
  return {
    version,
    sequence: Number(results[0].results[0]?.seq ?? 0),
    previousVersion: patch === null ? "" : previous!,
    uploaded: patch ?? 0,
    headers: JSON.parse(space.headers),
    filename: space.filename,
    importedAt: space.imported_at,
    updatedAt: space.updated_at,
    settings: preferences(space),
    connected,
    serverManagedKey: connected,
    usage: JSON.parse(space.usage),
    importing: space.import_lock,
    refresh: results[1].results[0] ?? null,
  };
}

function cursor(params: URLSearchParams, name: string, fallback: number) {
  const value = Number(params.get(name) ?? fallback);
  if (!Number.isSafeInteger(value) || value < fallback) throw new AppError("Invalid inventory sync cursor.");
  return value;
}

export async function syncInventory(owner: string, params: URLSearchParams) {
  const version = params.get("version") ?? "";
  const after = cursor(params,"after",-1);
  const snapshot = await database().prepare("SELECT active_version FROM workspaces WHERE owner=?").bind(owner).first<string>("active_version");
  if ((snapshot ?? "") !== version) throw new AppError("Inventory changed during sync. Reload to try again.",409);
  if (!version) return {rows:[], next:null};
  await limitOperation(owner,"inventory-pages",1200,86_400_000);
  if (after === -1) await limitOperation(owner,"inventory-snapshot",8,60_000);
  const maxRow = params.has("uploaded") ? cursor(params,"uploaded",0) : Number.MAX_SAFE_INTEGER;
  const rows = await database().prepare(
    "SELECT r.row_no AS rowNo,r.raw,c.card_key AS key,c.info,c.quantity,m.product_id AS marketProduct,m.data,m.detail,m.fetched_at AS fetchedAt," +
    "json_extract(a.data,'$.productId') AS mappedProduct FROM inventory_rows r INDEXED BY rows_owner_version " +
    "CROSS JOIN cards c ON c.owner=r.owner AND c.version=r.version AND c.card_key=r.card_key " +
    "LEFT JOIN market m ON m.owner=c.owner AND m.card_key=c.card_key " +
    "LEFT JOIN api_cache a ON a.id=c.owner||'|sku-map:'||json_extract(c.info,'$.skuId') " +
    "WHERE r.owner=? AND r.version=? AND r.row_no>? AND r.row_no<? ORDER BY r.row_no LIMIT ?"
  ).bind(owner,version,after,maxRow,PAGE_SIZE).all<{rowNo:number}>();
  return {rows:rows.results,next:rows.results.length===PAGE_SIZE ? rows.results.at(-1)!.rowNo : null};
}

export async function syncChanges(owner: string, params: URLSearchParams) {
  const after = cursor(params,"after",0), through = cursor(params,"through",0);
  await limitOperation(owner,"inventory-pages",1200,86_400_000);
  const rows = await database().prepare(
    "SELECT e.seq,e.kind,e.subject,m.product_id AS marketProduct,m.data,m.detail,m.fetched_at AS fetchedAt," +
    "json_extract(a.data,'$.productId') AS mappedProduct,r.row_no AS rowNo,r.raw,c.info,c.quantity," +
    "(SELECT json_group_array(json_object('rowNo',other.row_no,'raw',other.raw)) FROM inventory_rows other INDEXED BY rows_card " +
    "WHERE other.owner=r.owner AND other.version=r.version AND other.card_key=r.card_key AND other.id<>r.id) AS extraOriginals " +
    "FROM sync_events e INDEXED BY sync_events_owner_seq " +
    "LEFT JOIN workspaces w ON e.kind='inventory' AND w.owner=e.owner " +
    "LEFT JOIN cards c ON c.owner=w.owner AND c.version=w.active_version AND c.card_key=e.subject " +
    "LEFT JOIN inventory_rows r ON r.id=(SELECT id FROM inventory_rows INDEXED BY rows_card " +
    "WHERE owner=c.owner AND version=c.version AND card_key=c.card_key ORDER BY row_no LIMIT 1) " +
    "LEFT JOIN market m ON e.kind IN ('market','inventory') AND m.owner=e.owner AND m.card_key=e.subject " +
    "LEFT JOIN api_cache a ON a.id=e.owner||'|sku-map:'||CASE WHEN e.kind='sku' THEN e.subject ELSE json_extract(c.info,'$.skuId') END " +
    "WHERE e.owner=? AND e.seq>? AND e.seq<=? ORDER BY e.seq LIMIT ?"
  ).bind(owner,after,through,PAGE_SIZE).all<{seq:number;kind:string}>();
  if (!params.has("inventoryEdits") && rows.results.some(row=>row.kind==="inventory"))
    throw new AppError("Reload the app to sync edited inventory rows.",409);
  return {rows:rows.results,next:rows.results.length===PAGE_SIZE ? rows.results.at(-1)!.seq : null};
}
