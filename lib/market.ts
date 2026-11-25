import { apiKey, AppError, buildQuery, database, preferences, workspace, type QueryInput } from "./data";
import { API_SH_BASE, DAY, normalizeMarket, ranges, type HistoryRange } from "./api-sh";
import { reserveCredits, settleCredits, syncAccount, freeGet } from "./credits";
export { normalizeMarket } from "./api-sh";
type Json=Record<string,any>;
type RefreshInput=QueryInput & {onlyStale?:boolean;range?:HistoryRange;includePricing?:boolean;includeListings?:boolean;prioritizeUnanalyzed?:boolean;maxProducts?:number;approvedCost?:number};
async function cache(owner:string,path:string) { return database().prepare("SELECT data,fetched_at FROM api_cache WHERE id=? AND owner=?").bind(owner+"|api-sh:"+path,owner).first<{data:string;fetched_at:number}>(); }
async function saveCache(owner:string,path:string,body:Json) { await database().prepare("INSERT INTO api_cache (id,owner,fetched_at,data) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET fetched_at=excluded.fetched_at,data=excluded.data").bind(owner+"|api-sh:"+path,owner,Date.now(),JSON.stringify(body)).run(); }
async function activeRun(owner:string,id:string) { const row=await database().prepare("SELECT * FROM refresh_runs WHERE owner=? AND id=?").bind(owner,id).first<Json>(); if(!row||row.status!=="running") throw new AppError("Refresh cancelled or already finished.",409); return row; }
function paths(id:string,options:Json) { return ["/tcgplayer/v1/price-history?id="+id+"&range="+options.range,...(options.includePricing?["/tcgplayer/v1/product?id="+id+"&sku_prices=1"]:[]),...(options.includeListings?["/tcgplayer/v1/listings?id="+id+"&limit=50&page=1"]:[])]; }
export async function provider(owner:string,runId:string,key:string,path:string,staleHours:number) {
  const old=await cache(owner,path);
  if(old&&Date.now()-old.fetched_at<staleHours*3600000) return JSON.parse(old.data);
  await activeRun(owner,runId);
  const reservation=await reserveCredits(owner,runId,path,1);
  let response:Response|null=null,body:Json={},charge;
  try { response=await fetch(API_SH_BASE+path,{headers:{"x-api-key":key,Accept:"application/json"},signal:AbortSignal.timeout(125000)});body=await response.json() as Json; }
  finally {
    charge=await settleCredits(reservation,response,body,owner);
    await database().prepare("UPDATE refresh_runs SET spent=spent+?,detail=json_set(detail,'$.requests',COALESCE(json_extract(detail,'$.requests'),0)+1,'$.failedRequests',COALESCE(json_extract(detail,'$.failedRequests'),0)+?) WHERE id=? AND owner=?").bind(charge.used,response?.ok?0:1,runId,owner).run();
  }
  if(!response?.ok || body.success===false || body.error) throw new AppError("API.SH could not return this product (HTTP "+(response?.status??"timeout")+"). Previous data is preserved.",response?.status===401||response?.status===402||response?.status===403?403:response?.status===429?429:502);
  const stored={body,requestId:charge.requestId,fetchedAt:Date.now(),path};
  await saveCache(owner,path,stored);
  await saveCache(owner,"archive:"+(charge.requestId??reservation.id),stored);
  return stored;
}
export async function refreshPlan(owner:string,input:RefreshInput) {
  const space=await workspace(owner),p=preferences(space),q=buildQuery(owner,space,input);
  const options={range:ranges.includes(input.range as HistoryRange)?input.range!:p.historyRange,includePricing:input.includePricing===true,includeListings:input.includeListings===true,prioritizeUnanalyzed:input.prioritizeUnanalyzed!==false,maxProducts:Math.max(1,Math.min(1000,Math.floor(input.maxProducts??p.maxProducts)))};
  const rows=await database().prepare("SELECT key,productId,skuId,fetchedAt,partial,available,analyzed FROM ("+q.sql+")").bind(...q.values).all<Json>();
  const targets=rows.results.filter(r=>!input.onlyStale||!r.analyzed||r.partial||!r.fetchedAt||r.fetchedAt<Date.now()-p.staleHours*3600000);
  const groups=[...new Map(targets.filter(r=>/^\d+$/.test(String(r.productId??""))).map(r=>[String(r.productId),r])).values()].sort((a,b)=>(options.prioritizeUnanalyzed?Number(!!a.analyzed)-Number(!!b.analyzed):0)||Number(a.fetchedAt??0)-Number(b.fetchedAt??0));
  const cached=await database().prepare("SELECT id,fetched_at FROM api_cache WHERE owner=? AND id LIKE ?").bind(owner,owner+"|api-sh:/tcgplayer/%").all<Json>();
  const fresh=new Set(cached.results.filter(r=>r.fetched_at>Date.now()-p.staleHours*3600000).map(r=>r.id));
  let account:Json|null=null,accountError="";
  try {account=await syncAccount(owner);}catch(e){accountError=e instanceof Error?e.message:String(e);}
  let budget=account?.available??0,cost=0;
  const chosen:Json[]=[];
  for(const group of groups) {
    if(chosen.length>=options.maxProducts) break;
    const needed=paths(String(group.productId),options).filter(path=>!fresh.has(owner+"|api-sh:"+path)).length;
    if(needed>budget) continue;
    chosen.push(group);budget-=needed;cost+=needed;
  }
  return {keys:chosen.map(r=>r.key),cards:targets.length,groups:chosen.length,eligibleProducts:groups.length,deferredProducts:groups.length-chosen.length,unresolved:new Set(targets.filter(r=>!r.productId).map(r=>r.skuId||r.key)).size,minimumCredits:cost,maximumCredits:cost,minimumRequests:cost,maximumRequests:cost,options,account,accountError,note:"One credit per product history; optional SKU pricing and one listing/competition page each add one credit. Fresh local results cost zero. "+(groups.length-chosen.length)+" products deferred to a later refresh. SKU-only cards need a verified Product ID; they are never treated as zero sales."};
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
  if(history.currency && history.currency!=="USD") throw new AppError("The provider returned a non-USD history. Previous data is preserved.",502);
  const space=await workspace(owner),skuIds=history.series.filter((s:any)=>s&&typeof s==="object"&&/^\d+$/.test(String(s.sku))).map((s:any)=>String(s.sku));
  for(const sku of skuIds) await database().prepare("INSERT INTO api_cache (id,owner,fetched_at,data) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET fetched_at=excluded.fetched_at,data=excluded.data").bind(owner+"|sku-map:"+sku,owner,Date.now(),JSON.stringify({productId,verified:true})).run();
  const inventory=await database().prepare("SELECT c.card_key,c.info,c.quantity FROM cards c LEFT JOIN market m ON m.owner=c.owner AND m.card_key=c.card_key WHERE c.owner=? AND c.version=? AND (json_extract(c.info,'$.productId')=? OR m.product_id=? OR json_extract(c.info,'$.skuId') IN (SELECT value FROM json_each(?)))").bind(owner,space.active_version??"",productId,productId,JSON.stringify(skuIds)).all<Json>();
  for(const row of inventory.results) {
    const previous=await database().prepare("SELECT data,detail,fetched_at FROM market WHERE owner=? AND card_key=?").bind(owner,row.card_key).first<Json>();
    if(previous && previous.fetched_at>fetchedAt)continue;
    const normalized=normalizeMarket({...JSON.parse(row.info),quantity:row.quantity},history,extras,fetchedAt);
    if(!normalized.metrics.available && previous && JSON.parse(previous.data).available)continue;
    normalized.metrics.partial=issues.length>0;

    await database().prepare("INSERT INTO market (id,owner,card_key,product_id,fetched_at,data,detail) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET product_id=excluded.product_id,fetched_at=excluded.fetched_at,data=excluded.data,detail=excluded.detail").bind(owner+"|"+row.card_key,owner,row.card_key,productId,fetchedAt,JSON.stringify(normalized.metrics),JSON.stringify({...normalized.detail,sources,issues})).run();
  }
}
export async function refreshStep(owner:string,runId:string,cardKey:string) {
  const run=await activeRun(owner,runId);
  const target=await database().prepare("SELECT id FROM refresh_targets WHERE id=? AND owner=?").bind(runId+"|"+cardKey,owner).first();
  if(!target) throw new AppError("This product is not part of the approved refresh.",403);
  const marker=await cache(owner,"run-item:"+runId+":"+cardKey);if(marker)return JSON.parse(marker.data);
  const space=await workspace(owner),q=buildQuery(owner,space,{selected:[cardKey]}),row=await database().prepare("SELECT productId FROM ("+q.sql+")").bind(...q.values).first<Json>();
  if(!row?.productId)throw new AppError("A verified Product ID is required.",409);
  const productId=String(row.productId),claim=await database().prepare("INSERT OR IGNORE INTO refresh_products (id,owner,run_id,product_id,status) VALUES (?,?,?,?,'running')").bind(runId+":"+productId,owner,runId,productId).run();
  if(!claim.meta.changes) throw new AppError("This product was already requested in this refresh.",409);
  let error:string|undefined;
  try {
    const options=JSON.parse(run.detail).options,p=preferences(space),key=await apiKey(space),results:Json[]=[],issues:string[]=[];
    for(const path of paths(productId,options)) {
      try {results.push(await provider(owner,runId,key,path,p.staleHours));}
      catch(e){if(!results.length)throw e;issues.push(e instanceof Error?e.message:String(e));if(e instanceof AppError&&[403,409,429].includes(e.status))await cancelRefresh(owner,runId);break;}
    }
    const extras:Json={};for(const r of results.slice(1)){if(r.path.startsWith("/tcgplayer/v1/product?"))extras.product=r.body;if(r.path.startsWith("/tcgplayer/v1/listings?"))extras.listings=r.body;}
    await applyHistory(owner,productId,results[0].body,extras,results.map(r=>({path:r.path,requestId:r.requestId,fetchedAt:r.fetchedAt})),issues,results[0].fetchedAt);
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
  const body=await freeGet(await apiKey(await workspace(owner)),"/v1/results/"+encodeURIComponent(row.request_id));
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
