import { apiKey, AppError, buildQuery, database, preferences, productIdExpression, workspace, type QueryInput } from "./data";
import { API_SH_BASE, DAY, normalizeMarket, salesHistoryPath, salesOnlyResponse, mergeSalesHistory, type HistoryRange } from "./api-sh";
import { reserveCredits, settleCredits, syncAccount, freeGet } from "./credits";
export { normalizeMarket } from "./api-sh";
type Json=Record<string,any>;
type RefreshInput=QueryInput & {onlyStale?:boolean;range?:HistoryRange;includePricing?:boolean;includeListings?:boolean;prioritizeUnanalyzed?:boolean;maxProducts?:number;approvedCost?:number};
async function cache(owner:string,path:string) { return database().prepare("SELECT data,fetched_at FROM api_cache WHERE id=? AND owner=?").bind(owner+"|api-sh:"+path,owner).first<{data:string;fetched_at:number}>(); }
async function saveCache(owner:string,path:string,body:Json) { await database().prepare("INSERT INTO api_cache (id,owner,fetched_at,data) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET fetched_at=excluded.fetched_at,data=excluded.data").bind(owner+"|api-sh:"+path,owner,Date.now(),JSON.stringify(body)).run(); }
async function activeRun(owner:string,id:string) { const row=await database().prepare("SELECT * FROM refresh_runs WHERE owner=? AND id=?").bind(owner,id).first<Json>(); if(!row||row.status!=="running") throw new AppError("Refresh cancelled or already finished.",409); return row; }
// Sales history is the only paid endpoint this app may request, including
// old saved options and refresh runs created before this restriction.
function paths(id:string) { return [salesHistoryPath(id)]; }
export async function provider(owner:string,runId:string,key:string,path:string,staleHours:number) {
  const product=path.match(/^\/tcgplayer\/v1\/price-history\?id=(\d+)&/);
  if(!product || path!==salesHistoryPath(product[1])) throw new AppError("Only sales-quantity history requests are enabled.",403);
  const old=await cache(owner,path) ?? await cache(owner,"/tcgplayer/v1/price-history?id="+product[1]+"&range=annual");
  if(old&&Date.now()-old.fetched_at<staleHours*3600000) {const saved=JSON.parse(old.data);return {...saved,path,body:salesOnlyResponse(saved.body)};}
  await activeRun(owner,runId);
  const reservation=await reserveCredits(owner,runId,path,1);
  let response:Response|null=null,body:Json={},charge;
  try { response=await fetch(API_SH_BASE+path,{headers:{"x-api-key":key,Accept:"application/json"},signal:AbortSignal.timeout(125000)});body=await response.json() as Json; }
  finally {
    charge=await settleCredits(reservation,response,body,owner);
    await database().prepare("UPDATE refresh_runs SET spent=spent+?,detail=json_set(detail,'$.requests',COALESCE(json_extract(detail,'$.requests'),0)+1,'$.failedRequests',COALESCE(json_extract(detail,'$.failedRequests'),0)+?) WHERE id=? AND owner=?").bind(charge.used,response?.ok?0:1,runId,owner).run();
  }
  if(!response?.ok || body.success===false || body.error) throw new AppError("API.SH could not return this product (HTTP "+(response?.status??"timeout")+"). Previous data is preserved.",response?.status===401||response?.status===402||response?.status===403?403:response?.status===429?429:502);
  const stored={body:salesOnlyResponse(body),requestId:charge.requestId,fetchedAt:Date.now(),path};
  await saveCache(owner,path,stored);
  await saveCache(owner,"archive:"+(charge.requestId??reservation.id),stored);
  return stored;
}
export async function refreshPlan(owner:string,input:RefreshInput) {
  const db = database(), day = Math.floor(Date.now() / DAY);
  const usage = await db.prepare("SELECT rows_read FROM refresh_read_budget WHERE day=?").bind(day).first<number>("rows_read");
  const limit = 2_000_000;
  const budgetError = "Sales-history planning is paused until the next UTC day to leave database capacity for browsing.";
  if ((usage ?? 0) >= limit) throw new AppError(budgetError, 429);
  const space=await workspace(owner),p=preferences(space),q=buildQuery(owner,space,input);
  const options={range:"annual",includePricing:false,includeListings:false,prioritizeUnanalyzed:input.prioritizeUnanalyzed!==false,maxProducts:Math.max(1,Math.min(1000,Math.floor(input.maxProducts??p.maxProducts)))};
  const rows=await db.prepare("SELECT key,productId,skuId,fetchedAt,partial,available,analyzed,historyRange FROM ("+q.sql+")").bind(...q.values).all<Json>();
  const targets=rows.results.filter(r=>!input.onlyStale||!r.analyzed||r.partial||r.historyRange!=="annual"||!r.fetchedAt||r.fetchedAt<Date.now()-p.staleHours*3600000);
  const groups=[...new Map(targets.filter(r=>/^\d+$/.test(String(r.productId??""))).map(r=>[String(r.productId),r])).values()].sort((a,b)=>(options.prioritizeUnanalyzed?Number(!!a.analyzed)-Number(!!b.analyzed):0)||Number(a.fetchedAt??0)-Number(b.fetchedAt??0));
  const cachePrefix = owner + "|api-sh:/tcgplayer";
  const cached=await db.prepare("SELECT id,fetched_at FROM api_cache WHERE owner=? AND id>=? AND id<?").bind(owner,cachePrefix+"/",cachePrefix+"0").all<Json>();
  const reads = (rows.meta?.rows_read ?? 0) + (cached.meta?.rows_read ?? 0);
  const used = await db.prepare("INSERT INTO refresh_read_budget(day,rows_read) VALUES (?,?) ON CONFLICT(day) DO UPDATE SET rows_read=rows_read+excluded.rows_read RETURNING rows_read").bind(day,reads).first<number>("rows_read");
  if ((used ?? 0) >= limit) throw new AppError(budgetError, 429);
  const fresh=new Set(cached.results.filter(r=>r.fetched_at>Date.now()-p.staleHours*3600000).map(r=>r.id));
  let account:Json|null=null,accountError="";
  try {account=await syncAccount(owner);}catch(e){accountError=e instanceof Error?e.message:String(e);}
  let budget=account?.available??0,cost=0;
  const chosen:Json[]=[];
  for(const group of groups) {
    if(chosen.length>=options.maxProducts) break;
    const needed=paths(String(group.productId)).filter(path=>!fresh.has(owner+"|api-sh:"+path)&&!fresh.has(owner+"|api-sh:/tcgplayer/v1/price-history?id="+group.productId+"&range=annual")).length;
    if(needed>budget) continue;
    chosen.push(group);budget-=needed;cost+=needed;
  }
  const deferred=groups.length-chosen.length;
  return {keys:chosen.map(r=>r.key),cards:targets.length,groups:chosen.length,eligibleProducts:groups.length,deferredProducts:deferred,unresolved:new Set(targets.filter(r=>!r.productId).map(r=>r.skuId||r.key)).size,minimumCredits:cost,maximumCredits:cost,minimumRequests:cost,maximumRequests:cost,options,account,accountError,note:"Sales history only. One credit per unique Product ID. Fresh saved results cost no credits."+(deferred?" "+deferred+" products remain for a later pull within your free credit balance and product limit.":"")};
}
export async function startRefresh(owner:string,input:RefreshInput) {
  const space=await workspace(owner);await apiKey(space);
  if(space.import_lock) throw new AppError("Wait for the CSV import to finish.",409);
  const plan=await refreshPlan(owner,input);
  if(!plan.groups) throw new AppError(plan.accountError||"No products can be refreshed with the available free credits. Add Product IDs for unresolved cards.",409);
  if(input.approvedCost===undefined || plan.maximumCredits>input.approvedCost) throw new AppError("The estimate changed. Review the credit cost before refreshing.",409);
  const id=crypto.randomUUID(),{keys,...summary}=plan;
  const created=await database().prepare("INSERT INTO refresh_runs (id,owner,status,started_at,total,detail) SELECT ?,?,'running',?,?,? FROM workspaces WHERE owner=? AND import_lock IS NULL AND active_version=? AND NOT EXISTS (SELECT 1 FROM refresh_runs WHERE owner=? AND status='running')").bind(id,owner,Date.now(),plan.groups,JSON.stringify({...summary,requests:0,failedRequests:0}),owner,space.active_version,owner).run();
  if(!created.meta.changes) throw new AppError("A refresh or import is already active.",409);
  await database().prepare("INSERT INTO refresh_targets (id,owner,run_id,card_key) SELECT ?||'|'||value,?,?,value FROM json_each(?)").bind(id,owner,id,JSON.stringify(keys)).run();
  return {id,...plan};
}
export async function cancelRefresh(owner:string,id:string) { await database().prepare("UPDATE refresh_runs SET status='cancelled' WHERE owner=? AND id=? AND status='running'").bind(owner,id).run();return {cancelled:true}; }
async function applyHistory(owner:string,productId:string,history:Json,extras:Json,sources:Json,issues:string[]=[],fetchedAt=Date.now()) {
  if(String(history.product_id)!==productId||!Array.isArray(history.series)) throw new AppError("API.SH returned an unexpected product. Previous data is preserved.",502);
  const space=await workspace(owner),skuIds=[...new Set<string>(history.series.flatMap((s:Json|null) => s && /^\d+$/.test(String(s.sku)) ? [String(s.sku)] : []))];
  for(const sku of skuIds) await database().prepare("INSERT INTO api_cache (id,owner,fetched_at,data) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET fetched_at=excluded.fetched_at,data=excluded.data").bind(owner+"|sku-map:"+sku,owner,Date.now(),JSON.stringify({productId,verified:true})).run();
  const version = space.active_version ?? "";
  // Each branch looks up matching keys through its own index. An OR across
  // cards and market made SQLite read the entire inventory for every product.
  const inventory = await database().prepare(`WITH matched AS (
    SELECT card_key FROM cards WHERE owner=? AND version=? AND json_extract(info,'$.productId')=?
    UNION
    SELECT card_key FROM cards WHERE owner=? AND version=? AND json_extract(info,'$.skuId') IN (SELECT value FROM json_each(?))
    UNION
    SELECT card_key FROM market WHERE owner=? AND product_id=?
  )
  SELECT c.card_key,c.info,c.quantity FROM matched
  CROSS JOIN cards c ON c.owner=? AND c.version=? AND c.card_key=matched.card_key`)
    .bind(owner,version,productId,owner,version,JSON.stringify(skuIds),owner,productId,owner,version)
    .all<Json>();
  for(const row of inventory.results) {
    const previous=await database().prepare("SELECT data,detail,fetched_at FROM market WHERE owner=? AND card_key=?").bind(owner,row.card_key).first<Json>();
    if(previous && previous.fetched_at>fetchedAt && JSON.parse(previous.data).historyRange==="annual")continue;
    const normalized=normalizeMarket({...JSON.parse(row.info),quantity:row.quantity},history,extras,fetchedAt);
    if(!normalized.metrics.available && previous && JSON.parse(previous.data).available)continue;
    normalized.metrics.partial=issues.length>0;
    const oldDetail=previous?JSON.parse(previous.detail):null;
    if(oldDetail?.range===history.range && Array.isArray(oldDetail.history)) {
      const older=oldDetail.history.filter((point:Json)=>Number.isFinite(point.date)&&(normalized.metrics.historyFrom===null||point.date<normalized.metrics.historyFrom));
      if(older.length) normalized.metrics.unitsSold=normalized.metrics.unitsSold!==null&&older.every((point:Json)=>point.units!==null&&point.units>=0)?normalized.metrics.unitsSold+older.reduce((sum:number,point:Json)=>sum+point.units,0):null;
      normalized.detail.history=mergeSalesHistory(oldDetail.history,normalized.detail.history);
      normalized.metrics.historyFrom=normalized.detail.history[0]?.date??null;
      normalized.metrics.historyTo=normalized.detail.history.at(-1)?.date??null;
    }

    await database().prepare("INSERT INTO market (id,owner,card_key,product_id,fetched_at,data,detail) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET product_id=excluded.product_id,fetched_at=excluded.fetched_at,data=excluded.data,detail=excluded.detail").bind(owner+"|"+row.card_key,owner,row.card_key,productId,fetchedAt,JSON.stringify(normalized.metrics),JSON.stringify({...normalized.detail,sources,issues})).run();
  }
}
export async function refreshStep(owner:string,runId:string,cardKey:string) {
  await activeRun(owner,runId);
  const target=await database().prepare("SELECT id FROM refresh_targets WHERE id=? AND owner=?").bind(runId+"|"+cardKey,owner).first();
  if(!target) throw new AppError("This product is not part of the approved refresh.",403);
  const marker=await cache(owner,"run-item:"+runId+":"+cardKey);if(marker)return JSON.parse(marker.data);
  const space = await workspace(owner);
  const row = await database().prepare(`SELECT ${productIdExpression} AS productId
    FROM cards c LEFT JOIN market m ON m.owner=c.owner AND m.card_key=c.card_key
    WHERE c.owner=? AND c.version=? AND c.card_key=?`)
    .bind(owner,space.active_version??"",cardKey).first<{productId:string|null}>();
  if(!row?.productId)throw new AppError("A verified Product ID is required.",409);
  const productId=String(row.productId),claim=await database().prepare("INSERT OR IGNORE INTO refresh_products (id,owner,run_id,product_id,status) VALUES (?,?,?,?,'running')").bind(runId+":"+productId,owner,runId,productId).run();
  if(!claim.meta.changes) throw new AppError("This product was already requested in this refresh.",409);
  let error:string|undefined;
  try {
    const p=preferences(space),key=await apiKey(space),results:Json[]=[],issues:string[]=[];
    for(const path of paths(productId)) {
      try {results.push(await provider(owner,runId,key,path,p.staleHours));}
      catch(e){if(!results.length)throw e;issues.push(e instanceof Error?e.message:String(e));if(e instanceof AppError&&[403,409,429].includes(e.status))await cancelRefresh(owner,runId);break;}
    }
    await applyHistory(owner,productId,results[0].body,{},results.map(r=>({path:r.path,requestId:r.requestId,fetchedAt:r.fetchedAt})),issues,results[0].fetchedAt);
    if(issues.length)error=issues.join(" ");
  }catch(e){error=e instanceof Error?e.message:String(e);if(e instanceof AppError&&[403,409,429].includes(e.status))await cancelRefresh(owner,runId);}
  await database().prepare("UPDATE refresh_products SET status=? WHERE id=? AND owner=?").bind(error?"error":"complete",runId+":"+productId,owner).run();
  await database().prepare("UPDATE refresh_runs SET completed=completed+1,failed=failed+?,detail=json_set(detail,'$.lastError',?) WHERE owner=? AND id=?").bind(error?1:0,error??null,owner,runId).run();
  await database().prepare("UPDATE refresh_runs SET status='complete' WHERE owner=? AND id=? AND status='running' AND completed>=total").bind(owner,runId).run();
  const result=await database().prepare("SELECT id,status,completed,failed,total,spent,detail FROM refresh_runs WHERE owner=? AND id=?").bind(owner,runId).first<Json>();
  const output={...result,error};await saveCache(owner,"run-item:"+runId+":"+cardKey,output);return output;
}
export async function recoverResult(owner:string,id:string) {
  const row=await database().prepare("SELECT * FROM api_requests WHERE id=? AND owner=?").bind(id,owner).first<Json>();
  if(!row?.request_id || Date.now()-row.created_at>=30*DAY) throw new AppError("This request has no recoverable result within API.SH's 30-day retention.",410);
  const body=salesOnlyResponse(await freeGet(await apiKey(await workspace(owner)),"/v1/results/"+encodeURIComponent(row.request_id)));
  // Recovered bodies repeat original credits_used; this is a free read, never a new charge.
  await saveCache(owner,row.path,{body,requestId:row.request_id,fetchedAt:row.created_at,path:row.path,recoveredAt:Date.now()});
  if(row.path.startsWith("/tcgplayer/v1/price-history?")) await applyHistory(owner,String(body.product_id),body,{},[{requestId:row.request_id,recovered:true}],[],row.created_at);
  return {recovered:true,creditsUsed:0};
}
export async function linkProduct(owner:string,cardKey:string,productId:string) {
  if(!/^\d+$/.test(productId))throw new AppError("Enter the numeric Product ID from the TCGplayer product URL.");
  const space=await workspace(owner),row=await database().prepare("SELECT info FROM cards WHERE owner=? AND version=? AND card_key=?").bind(owner,space.active_version??"",cardKey).first<Json>();
  if(!row)throw new AppError("Card not found.",404);
  const info=JSON.parse(row.info);if(!info.skuId)throw new AppError("This row already has an imported Product ID. Update it through your CSV.");
  await database().prepare("INSERT INTO api_cache (id,owner,fetched_at,data) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET fetched_at=excluded.fetched_at,data=excluded.data").bind(owner+"|sku-map:"+info.skuId,owner,Date.now(),JSON.stringify({productId,userProvided:true})).run();
  return {saved:true};
}
