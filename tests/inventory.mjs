import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync} from "node:fs";
import ts from "typescript";
function moduleUrl(path,replacements={}) {
 let source=ts.transpileModule(readFileSync(new URL(path,import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 for(const [name,url] of Object.entries(replacements))source=source.replaceAll('from "'+name+'"','from '+JSON.stringify(url));
 return "data:text/javascript;base64,"+Buffer.from(source).toString("base64");
}
const sql=new DatabaseSync(":memory:");
for(const name of readdirSync(new URL("../drizzle",import.meta.url)).filter(name=>name.endsWith(".sql")).sort())sql.exec(readFileSync(new URL("../drizzle/"+name,import.meta.url),"utf8"));
function statement(query){let args=[];return {bind(...values){args=values;return this},async first(column){const row=sql.prepare(query).get(...args);return (column ? row?.[column] : row)??null},async all(){return {results:sql.prepare(query).all(...args)}},async run(){return this.sync()},sync(){const stmt=sql.prepare(query);return /^SELECT /.test(query) ? {results:stmt.all(...args)} : {meta:{changes:Number(stmt.run(...args).changes)}}}};}
globalThis.inventoryTestEnv={DB:{prepare:statement,async batch(statements){sql.exec("BEGIN");try{const results=statements.map(s=>s.sync());sql.exec("COMMIT");return results}catch(e){sql.exec("ROLLBACK");throw e}}}};
const domainUrl=moduleUrl("../lib/domain.ts"),csvUrl=moduleUrl("../lib/csv.ts",{"./domain":domainUrl});
const csv=await import(csvUrl),domain=await import(domainUrl);
const dataUrl=moduleUrl("../lib/data.ts",{"cloudflare:workers":"data:text/javascript,export const env=globalThis.inventoryTestEnv;","./domain":domainUrl,"./csv":csvUrl});
const data=await import(dataUrl);
const adapterUrl=moduleUrl("../lib/api-sh.ts"),creditsUrl=moduleUrl("../lib/credits.ts",{"./data":dataUrl,"./api-sh":adapterUrl});
const market=await import(moduleUrl("../lib/market.ts",{"./data":dataUrl,"./api-sh":adapterUrl,"./credits":creditsUrl}));
const sync=await import(moduleUrl("../lib/inventory-sync.ts",{"./data":dataUrl}));
const localUrl=moduleUrl("../lib/local-inventory.ts",{"./domain":domainUrl,"./csv":csvUrl});
const local=await import(localUrl);
const clientSync=await import(moduleUrl("../lib/inventory-cache.ts",{"./local-inventory":localUrl}));
const owner="inventory-test";
async function upload(text,mode="replace") {
 const prepared=csv.prepareImport(text,{productId:"Lookup"});
 const {id}=await data.startImport(owner,{mode,filename:"qa-simple.csv",headers:prepared.headers,count:prepared.rows.length});
 await data.uploadChunk(owner,id,0,prepared.rows);
 return data.commitImport(owner,id);
}
test("Unique CSV rows and original headers survive import, search, sort and export",async()=>{
 const realFetch=globalThis.fetch;
 globalThis.fetch=async()=>{throw new Error("Import and browsing must not request provider data");};
 try {
 const header=`Odd ' " header`;
 const input=[['Lookup','My label',header,'Units sold'],['123','First','0005','original'],['123','Second','keep, this',''],['456','Third','0001','source price']].map(row=>row.map(csv.csvCell).join(',')).join('\n');
 const state=await upload(input);
 assert.equal(state.uniqueCards,2);
 let result=await data.queryCards(owner,{sort:"rowNo",direction:"asc"});
 assert.equal(result.rows.length,2);assert.equal(result.rows[0]['csv:My label'],'First');assert.equal(result.rows[1]['csv:My label'],'Third');
 assert.equal(result.rows[0]['csv:'+header],'0005');assert.equal(result.rows[0].marketPrice,undefined);
 assert.equal((await data.queryCards(owner,{filters:{search:'keep, this'}})).matches,0);
 assert.equal((await data.queryCards(owner,{sort:'csv:'+header,direction:'asc'})).rows[0]['csv:My label'],'Third');
 const original=await (await data.exportInventory(owner,{})).text();
 const expected=csv.parseCSV(input);expected.records.splice(1,1);
 assert.deepEqual(csv.parseCSV(original),expected);
 const appended=csv.parseCSV(await (await data.exportInventory(owner,{analysis:true,sort:"rowNo",direction:"asc"})).text());
 assert.deepEqual(appended.headers.slice(0,4),['Lookup','My label',header,'Units sold']);
 assert(appended.headers.includes('Sales · Units sold'));
 assert.equal(appended.records[1][1],'Third');
 } finally {globalThis.fetch=realFetch;}
});
test("Column choices and order persist through later uploads, including temporarily absent headers",async()=>{
 const chosen=['unitsSold','csv:My label','csv:Lookup'];
 await data.savePreferences(owner,{settings:{visibleColumns:chosen,columnSelectionVersion:1}});
 let state=await upload('Lookup,My label,New field\n123,Updated,value');
 assert.deepEqual(state.settings.visibleColumns,['csv:New field',...chosen]);
 assert(!state.settings.visibleColumns.includes(`csv:Odd ' " header`));
 state=await upload('Lookup,Other\n789,replacement');
 assert(state.settings.visibleColumns.includes('csv:My label'));
 state=await upload('Lookup,My label\n123,Back');
 assert(state.settings.visibleColumns.includes('csv:My label'));
 assert((await data.state(owner)).settings.visibleColumns.includes('unitsSold'));
});
test("Rows with no name or quantity import and repeated updates retain row count",async()=>{
 await upload('Lookup,Custom\n123,one\n123,two');
 await upload('Lookup,Custom\n123,changed\n123,two','update');
 const state=await upload('Lookup,Custom\n123,changed\n123,two','update');
 assert.equal(state.uniqueCards,1);
 const rows=(await data.queryCards(owner,{sort:'rowNo',direction:'asc'})).rows;
 assert.deepEqual(rows.map(row=>row['csv:Custom']),['changed']);
});

test("All view preferences restore from the database and concurrent device saves preserve unrelated settings",async()=>{
 const realFetch=globalThis.fetch;
 globalThis.fetch=async()=>{throw Error('Settings must not request market data');};
 const db=globalThis.inventoryTestEnv.DB,prepare=db.prepare,queries=[];
 db.prepare=query=>{queries.push(query);return prepare(query);};
 try {
  const currentView=domain.normalizeView({filters:{search:'Charizard',categories:{set:['Base Set']},numeric:[{field:'unitsSold',min:'5',max:'25'}],dateFrom:'2026-01-01',dateTo:'2026-03-01',freshness:'analyzed'},sort:'unitsSold',direction:'desc',page:2,pageSize:25,view:'custom',advanced:true,exportScope:'all',exportAnalysis:true});
  const response=await data.savePreferences(owner,{settingsOnly:true,settings:{currentView,productIdColumn:'Lookup'}});
  assert.deepEqual(Object.keys(response),['settings']);
  assert(!queries.some(query=>/FROM cards|FROM market|FROM refresh_runs/i.test(query)),'Auto-saving must not scan inventory or market tables');
  let restored=(await data.state(owner)).settings;
  assert.deepEqual(restored.currentView,currentView);assert.equal(restored.productIdColumn,'Lookup');
  await Promise.all([
   data.savePreferences(owner,{settingsOnly:true,settings:{theme:'light'}}),
   data.savePreferences(owner,{settingsOnly:true,settings:{visibleColumns:['unitsSold','csv:Lookup']}}),
   data.savePreferences(owner,{settingsOnly:true,settings:{currentView:{...currentView,filters:{...domain.emptyFilters,search:'Pikachu'}}}}),
  ]);
  restored=(await data.state(owner)).settings;
  assert.equal(restored.theme,'light');assert.deepEqual(restored.visibleColumns,['unitsSold','csv:Lookup']);
  assert.equal(restored.currentView.filters.search,'Pikachu');assert.deepEqual(restored.currentView.filters.categories,{});
  assert.deepEqual(restored.currentView.filters.numeric,[]);assert.equal(restored.productIdColumn,'Lookup');
  await upload('Lookup,Custom\n123,after upload');
  restored=(await data.state(owner)).settings;
  assert.equal(restored.currentView.filters.search,'Pikachu');assert.equal(restored.productIdColumn,'Lookup');
 } finally {db.prepare=prepare;globalThis.fetch=realFetch;}
});
test("Server removes duplicates across chunks and updates while retaining first-row values and cached sales",async()=>{
 const realFetch=globalThis.fetch;
 globalThis.fetch=async()=>{throw Error('An import must not request sales data');};
 try {
  const prepared=csv.prepareImport('Lookup,Custom,Quantity\n11,first,2\n22,other,4',{productId:'Lookup'});
  const duplicate=structuredClone(prepared.rows[0]);duplicate.info.key='product:11|row:99';duplicate.info.quantity=99;duplicate.raw.Custom='later';
  const {id}=await data.startImport(owner,{mode:'replace',filename:'qa-chunks.csv',headers:prepared.headers,count:3});
  await data.uploadChunk(owner,id,0,prepared.rows);
  await data.uploadChunk(owner,id,2,[duplicate]);
  await data.uploadChunk(owner,id,0,prepared.rows);
  let state=await data.commitImport(owner,id);
  assert.equal(state.uniqueCards,2);assert.equal(state.totalCards,6);
  let rows=(await data.queryCards(owner,{sort:'rowNo',direction:'asc'})).rows;
  assert.deepEqual(rows.map(row=>row['csv:Custom']),['first','other']);
  assert.equal(csv.parseCSV(await (await data.exportInventory(owner,{})).text()).records.length,2);
  const version=sql.prepare('SELECT active_version FROM workspaces WHERE owner=?').get(owner).active_version;
  const old=sql.prepare('SELECT * FROM inventory_rows WHERE owner=? AND version=? AND card_key=?').get(owner,version,'product:22|row:0');
  const legacyInfo={...JSON.parse(old.info),key:'product:22|row:1',quantity:100};
  sql.prepare('INSERT INTO inventory_rows(id,owner,version,row_no,card_key,info,raw) VALUES (?,?,?,?,?,?,?)').run(version+':legacy',owner,version,99,legacyInfo.key,JSON.stringify(legacyInfo),JSON.stringify({...JSON.parse(old.raw),Custom:'legacy duplicate'}));
  sql.prepare('INSERT INTO cards(id,owner,version,card_key,info,quantity) VALUES (?,?,?,?,?,?)').run(version+':legacy',owner,version,legacyInfo.key,JSON.stringify(legacyInfo),100);
  sql.prepare('INSERT INTO market(id,owner,card_key,product_id,fetched_at,data,detail) VALUES (?,?,?,?,?,?,?)').run(owner+'|product:11|row:0',owner,'product:11|row:0','11',Date.now(),JSON.stringify({analyzed:true,available:true,unitsSold:7}),JSON.stringify({history:[]}));
  state=await upload('Lookup,Custom,Quantity\n11,updated,3\n11,ignored,99','update');
  assert.equal(state.uniqueCards,2);assert.equal(state.totalCards,7);
  rows=(await data.queryCards(owner,{sort:'rowNo',direction:'asc'})).rows;
  assert.deepEqual(rows.map(row=>row['csv:Custom']),['updated','other']);
  assert.equal(rows[0].unitsSold,7,'The retained Product ID keeps its saved sales');
  state=await upload('Lookup,Custom,Quantity\n11,updated,3\n11,ignored,99','update');
  assert.equal(state.uniqueCards,2);assert.equal(state.totalCards,7);
 } finally {globalThis.fetch=realFetch;}
});

test("Only sales quantities can be charged and dates filter the saved history, including old saved options and old refresh runs",async()=>{
 const realFetch=globalThis.fetch,paid=[];
 globalThis.inventoryTestEnv.API_SH_API_KEY="local-test-only-key";
 const history=id=>({product_id:Number(id),range:"annual",currency:"USD",series:[{sku:Number(id)+1000,total_quantity_sold:String(id)==='123'?7:11,points:[{date:'2026-01-01',quantity_sold:String(id)==='123'?2:6,market_price:999},{date:'2026-01-08',quantity_sold:String(id)==='123'?5:4},{date:'2026-01-15',quantity_sold:String(id)==='123'?0:1}]}],credits_used:1});
 globalThis.fetch=async input=>{
   const url=new URL(String(input));
   if(url.pathname==="/v1/account")return Response.json({account:{id:"sales-test",status:"active"},credits:{free:1000,total:2000,payg:1000,free_resets_at:new Date(Date.now()+30*86400000).toISOString()},spend:{this_month:0,today:0,monthly_limit:1000,daily_limit:null,period:"UTC"}});
   assert.equal(url.pathname,"/tcgplayer/v1/price-history");assert.equal(url.searchParams.get("range"),"annual");assert.equal(url.searchParams.get("raw"),"0");assert(!url.searchParams.get("fields").includes("price"));
   paid.push(url.href);return Response.json(history(url.searchParams.get("id")),{headers:{"x-credits-used":"1","x-request-id":crypto.randomUUID()}});
 };
 try {
   await upload('Lookup,Custom\n123,one\n123,two\n456,three');
   const state=await data.savePreferences(owner,{settings:{historyRange:"annual",includePricing:true,includeListings:true}});
   assert.equal(state.settings.historyRange,"annual");assert.equal(state.settings.includePricing,false);assert.equal(state.settings.includeListings,false);
   const rows=(await data.queryCards(owner,{})).rows;
   for(const row of rows.filter(row=>row.productId==='123'))sql.prepare("INSERT INTO market(id,owner,card_key,product_id,fetched_at,data,detail) VALUES (?,?,?,?,?,?,?)").run(owner+'|'+row.key,owner,row.key,'123',Date.now(),JSON.stringify({analyzed:true,available:true,granularity:'daily',historyRange:'month'}),'{}');
   const path='/tcgplayer/v1/price-history?id=123&range=annual',fetchedAt=Date.now()-1000;
   sql.prepare("INSERT INTO api_cache(id,owner,fetched_at,data) VALUES (?,?,?,?)").run(owner+'|api-sh:'+path,owner,fetchedAt,JSON.stringify({body:history(123),requestId:'cached',fetchedAt,path}));
   const input={onlyStale:true,range:'annual',includePricing:true,includeListings:true,maxProducts:100};
   const plan=await market.prepareRefreshPlan(owner,input);
   assert.equal(plan.groups,2);assert.equal(plan.maximumCredits,1);assert.equal(paid.length,0);
   assert.equal(plan.options.range,'annual');assert.equal(plan.options.includePricing,false);assert.equal(plan.options.includeListings,false);
   const started=await market.startRefresh(owner,{...input,approvedCost:1,planId:plan.planId});
   sql.prepare("UPDATE refresh_runs SET detail=json_set(detail,'$.options.range','annual','$.options.includePricing',1,'$.options.includeListings',1) WHERE id=?").run(started.id);
   for(const key of started.keys){const result=await market.refreshStep(owner,started.id,key);assert.equal(result.error,undefined);}
   assert.equal(paid.length,1);assert(paid[0].includes('id=456'));
   await assert.rejects(()=>market.startRefresh(owner,{...input,approvedCost:1,planId:plan.planId}),{status:409});
   assert((await data.queryCards(owner,{})).rows.every(row=>row.granularity==='weekly'));
   assert.equal((await market.refreshPlan(owner,input)).groups,0);
   const before=paid.length;
   const window={filters:{dateFrom:'2026-01-08',dateTo:'2026-01-14'}};
   const filtered=await data.queryCards(owner,window);
   assert.deepEqual(filtered.rows.map(row=>row.unitsSold).sort(),[4,5]);
   assert.equal((await data.queryCards(owner,{filters:{dateFrom:'2026-01-08',dateTo:'2026-01-14',numeric:[{field:'unitsSold',min:'5',max:'5'}]}})).matches,1);
   assert((await data.queryCards(owner,{filters:{dateFrom:'2027-01-01'}})).rows.every(row=>row.unitsSold===null));
   assert((await data.queryCards(owner,{filters:{dateFrom:'2026-01-09',dateTo:'2026-01-14'}})).rows.every(row=>row.unitsSold===null),'A partial week is never invented as a daily count');
   assert.equal((await data.queryCards(owner,{filters:{dateFrom:'2026-01-15',dateTo:'2026-01-15',numeric:[{field:'unitsSold',min:'0',max:'0'}]}})).matches,1);
   await assert.rejects(()=>data.queryCards(owner,{filters:{dateFrom:'2026-02-01',dateTo:'2026-01-01'}}),/valid sales date range/);
   const exported=csv.parseCSV(await (await data.exportInventory(owner,{...window,analysis:true})).text());
   const soldIndex=exported.headers.indexOf('Units sold');assert(soldIndex>=0);
   assert.deepEqual(exported.records.map(row=>Number(row[soldIndex])).sort(),[4,5]);
   assert.equal(paid.length,before,'Changing dates, filtering and exporting never request provider data');
   const repeated=await market.startRefresh(owner,{...input,onlyStale:false,approvedCost:0});
   for(const key of repeated.keys)await market.refreshStep(owner,repeated.id,key);
   assert.deepEqual((await data.queryCards(owner,{})).rows.map(row=>row.unitsSold).sort((a,b)=>a-b),[7,11]);
   assert.equal(paid.length,before,'Reapplying saved history neither double-counts sales nor spends credits');
   for(const row of sql.prepare('SELECT data,detail FROM market WHERE owner=?').all(owner)) assert(!/market_price|listingLow|netProceeds|marketPrice/.test(row.data+row.detail));
   for(const row of sql.prepare('SELECT data FROM api_cache WHERE owner=?').all(owner)) {const saved=JSON.parse(row.data);if(saved.body&&saved.path?.includes('raw=0'))assert(!JSON.stringify(saved.body).includes('market_price'));}

   const charged=sql.prepare("SELECT COUNT(*) AS total FROM api_requests").get().total;
   await assert.rejects(()=>market.provider(owner,started.id,'test','/tcgplayer/v1/product?id=123',24),/Only sales-quantity/);
   await assert.rejects(()=>market.provider(owner,started.id,'test','/tcgplayer/v1/listings?id=123',24),/Only sales-quantity/);
   assert.equal(sql.prepare("SELECT COUNT(*) AS total FROM api_requests").get().total,charged);
 } finally {globalThis.fetch=realFetch;delete globalThis.inventoryTestEnv.API_SH_API_KEY;}
});

test("A 100-product pull uses indexed lookups in a 50,000-card inventory", async () => {
 const pullOwner = "large-pull";
 const version = "active";
 const now = Date.now();
 const sku = "701";
 const cacheInsert = sql.prepare("INSERT INTO api_cache(id,owner,fetched_at,data) VALUES (?,?,?,?)");
 const insertCard = sql.prepare("INSERT INTO cards(id,owner,version,card_key,info,quantity) VALUES (?,?,?,?,?,1)");
 sql.prepare("INSERT INTO workspaces(owner,active_version) VALUES (?,?)").run(pullOwner,version);
 sql.exec("BEGIN");
 for (let id=1;id<=50000;id++) {
  insertCard.run(pullOwner+":"+id,pullOwner,version,"card:"+id,JSON.stringify({productId:String(id)}));
 }
 insertCard.run(pullOwner+":sku",pullOwner,version,"legacy-sku",JSON.stringify({skuId:sku}));
 insertCard.run(pullOwner+":saved",pullOwner,version,"legacy-saved",JSON.stringify({skuId:"702"}));
 sql.prepare("INSERT INTO market(id,owner,card_key,product_id,fetched_at,data,detail) VALUES (?,?,?,?,?,'{}','{}')")
   .run(pullOwner+"|legacy-saved",pullOwner,"legacy-saved","1",now-1);
 const keys = Array.from({length:100},(_,i)=>"card:"+(i+1));
 for (let id=1;id<=keys.length;id++) {
  const path = "/tcgplayer/v1/price-history?id="+id+"&range=annual";
  const body = {product_id:id,range:"annual",series:[{sku:id===1 ? Number(sku) : 1000+id,points:[{date:"2026-01-01",quantity_sold:id}]}]};
  cacheInsert.run(pullOwner+"|api-sh:"+path,pullOwner,now,JSON.stringify({body,path,fetchedAt:now}));
 }
 sql.exec("COMMIT");

 const db = globalThis.inventoryTestEnv.DB;
 const prepare = db.prepare;
 let lookups = 0;
 db.prepare = query => {
  const stmt = prepare(query);
  if (query.startsWith("WITH matched AS")) {
   const bind = stmt.bind;
   stmt.bind = function(...args) {
    const steps = sql.prepare("EXPLAIN QUERY PLAN "+query).all(...args).map(row=>row.detail);
    for (const index of ["cards_version_product","cards_version_sku","market_owner_product","cards_version_key"]) {
     assert(steps.some(step=>step.startsWith("SEARCH") && step.includes(index)),steps.join("\n"));
    }
    assert(!steps.some(step=>step.startsWith("SCAN cards") || step.startsWith("SCAN market")),steps.join("\n"));
    lookups++;
    return bind.apply(this,args);
   };
  }
  return stmt;
 };
 const realFetch = globalThis.fetch;
 globalThis.inventoryTestEnv.API_SH_API_KEY = "local-test-only-key";
 globalThis.fetch = async input => {
  assert.equal(new URL(String(input)).pathname,"/v1/account");
  return Response.json({account:{id:"large-pull",status:"active"},credits:{free:1000,free_resets_at:new Date(now+86400000).toISOString()},spend:{this_month:0,monthly_limit:1000,period:"UTC"}});
 };
 try {
  const started = await market.startRefresh(pullOwner,{selected:keys,maxProducts:100,approvedCost:0});
  assert.equal(started.keys.length,100);
  let result;
  for (const key of started.keys) {
   result = await market.refreshStep(pullOwner,started.id,key);
   assert.equal(result.error,undefined);
  }
  assert.equal(result.status,"complete");
  assert.equal(result.completed,100);
  assert.equal(lookups,100);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM market WHERE owner=?").get(pullOwner).count,102);
 } finally {
  db.prepare = prepare;
  globalThis.fetch = realFetch;
  delete globalThis.inventoryTestEnv.API_SH_API_KEY;
 }
});

test("Sales planning accounts for D1 row reads and pauses while inventory browsing stays available", async () => {
 const db = globalThis.inventoryTestEnv.DB, prepare = db.prepare;
 const day = Math.floor(Date.now()/86400000);
 sql.prepare("INSERT INTO refresh_read_budget(day,rows_read) VALUES (?,?) ON CONFLICT(day) DO UPDATE SET rows_read=excluded.rows_read").run(day,1999990);
 db.prepare = query => {
  const stmt = prepare(query);
  if (query.startsWith("SELECT key,productId,skuId")) {
   const all = stmt.all;
   stmt.all = async () => ({...await all(),meta:{rows_read:15}});
  }
  return stmt;
 };
 try {
  await assert.rejects(()=>market.refreshPlan(owner,{}),{status:429});
  assert.equal(sql.prepare("SELECT rows_read FROM refresh_read_budget WHERE day=?").get(day).rows_read,2000005);
  await assert.rejects(()=>market.refreshPlan(owner,{}),{status:429});
  assert.equal(sql.prepare("SELECT rows_read FROM refresh_read_budget WHERE day=?").get(day).rows_read,2000005);
  assert((await data.queryCards(owner,{})).rows.length > 0);
 } finally {
  db.prepare = prepare;
  sql.prepare("DELETE FROM refresh_read_budget WHERE day=?").run(day);
 }
});

test("Warm sync transfers only changed inventory rows and marketplace events", async () => {
 const requests = [];
 const api = route => {
  const [name,search] = route.split("?");
  const params = new URLSearchParams(search);
  requests.push(name);
  if (name === "sync/meta") return sync.syncMetadata(owner,params.get("version"));
  if (name === "sync/inventory") return sync.syncInventory(owner,params);
  if (name === "sync/changes") return sync.syncChanges(owner,params);
  throw Error("Unexpected route");
 };
 const initial = await upload("Lookup,Custom\n11,first\n22,other\n33,third");
 const baseline = await clientSync.synchronizeInventory(api,"test",null);
 assert.equal(baseline.cards.length,3);
 assert.deepEqual(requests.splice(0),["sync/meta","sync/inventory"]);
 const unchanged = await clientSync.synchronizeInventory(api,"test",baseline);
 assert.strictEqual(unchanged.cards,baseline.cards);
 assert.deepEqual(requests.splice(0),["sync/meta"]);
 await upload("Lookup,Custom\n22,revised","update");
 await upload("Lookup,Custom\n44,new","update");
 const meta=await sync.syncMetadata(owner,baseline.meta.version);
 assert.equal(meta.uploaded,2);
 const changed=await sync.syncInventory(owner,new URLSearchParams({version:meta.version,uploaded:String(meta.uploaded)}));
 assert.deepEqual(changed.rows.map(row=>JSON.parse(row.info).productId),["44","22"]);
 const patch=await clientSync.synchronizeInventory(api,"test",unchanged);
 assert.equal(patch.cards.length,4);
 assert.deepEqual(requests.splice(0),["sync/meta","sync/inventory"]);
 const server=await data.queryCards(owner,{sort:"rowNo",direction:"asc"});
 const browser=local.queryLocalInventory(local.indexInventory(patch.cards),{sort:"rowNo",direction:"asc"},24);
 assert.deepEqual(browser.rows.map(row=>[row.key,row.rowNo,row["csv:Custom"]]),server.rows.map(row=>[row.key,row.rowNo,row["csv:Custom"]]));
 const key=patch.cards.find(row=>JSON.parse(row.info).productId==="22").key;
 sql.prepare("INSERT INTO market(id,owner,card_key,product_id,fetched_at,data,detail) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,detail=excluded.detail,fetched_at=excluded.fetched_at")
   .run(owner+"|"+key,owner,key,"22",1,JSON.stringify({available:true,analyzed:true,unitsSold:8}),JSON.stringify({history:[{date:Date.UTC(2026,0,8),units:8}]}));
 sql.prepare("INSERT INTO api_cache(id,owner,fetched_at,data) VALUES (?,?,?,?)").run(owner+"|sku-map:770",owner,Date.now(),'{"productId":"22"}');
 const next=await clientSync.synchronizeInventory(api,"test",patch);
 assert.deepEqual(requests.splice(0),["sync/meta","sync/changes"]);
 assert.equal(next.cards.filter(row=>row===patch.cards.find(old=>old.key===row.key)).length,3);
 const delta=await sync.syncChanges(owner,new URLSearchParams({after:String(patch.meta.sequence),through:String(next.meta.sequence)}));
 assert.equal(delta.rows.find(row=>row.kind==="sku").subject,"770");
 assert.equal(JSON.parse(next.cards.find(row=>row.key===key).data).unitsSold,8);
 const input={filters:{...domain.emptyFilters,dateFrom:"2026-01-08",dateTo:"2026-01-08",search:"revised",numeric:[{field:"unitsSold",min:"8",max:"8"}]},sort:"unitsSold",direction:"desc"};
 const entries=local.indexInventory(next.cards);
 const localRows=local.queryLocalInventory(entries,input,24).rows;
 const serverRows=(await data.queryCards(owner,input)).rows;
 assert.deepEqual(localRows.map(row=>[row.key,row.unitsSold]),serverRows.map(row=>[row.key,row.unitsSold]));
 const originalCsv=csv.parseCSV(await (await data.exportInventory(owner,{})).text());
 const cachedCsv=csv.parseCSV(await local.localExport(entries,{},initial.headers,24,false).text());
 assert.deepEqual(cachedCsv,originalCsv);
 await sync.limitOperation(owner,"test-window",1,60000);
 await assert.rejects(()=>sync.limitOperation(owner,"test-window",1,60000),{status:429});
});

test("Visible-column facets and filters use raw CSV values and the displayed sales period",async()=>{
 const header = "Seller's \"Tags\"";
 const csvRows = [
  ["Lookup","Condition","Printing","Language","Tags",header,"Internal"],
  ["11","Near Mint","Foil","English","001","Shelf A","Hidden 1"],
  ["22","Lightly Played","Normal","Japanese","1","Shelf B","Hidden 2"],
  ["33","Near Mint","Normal","English","","Shelf A","Hidden 3"],
 ];
 const initial = await upload(csvRows.map(row=>row.map(csv.csvCell).join(",")).join("\n"));
 const putMarket = sql.prepare("INSERT INTO market(id,owner,card_key,product_id,fetched_at,data,detail) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET fetched_at=excluded.fetched_at,data=excluded.data,detail=excluded.detail");
 for (const [productId,units] of [["11",0],["22",8],["33",3]]) {
  const key = "product:"+productId+"|row:0";
  const first = Date.UTC(2026,0,1), second = Date.UTC(2026,0,8);
  putMarket.run(owner+"|"+key,owner,key,productId,second,JSON.stringify({scope:"Product",unitsSold:units+2,available:true}),JSON.stringify({history:[{date:first,units:2},{date:second,units}]}));
 }
 const version = (await sync.syncMetadata(owner,null)).version;
 const snapshot = await sync.syncInventory(owner,new URLSearchParams({version}));
 const entries = local.indexInventory(snapshot.rows);
 const visibleKeys = ["csv:Condition","csv:Printing","csv:Language","csv:Tags",domain.csvColumnKey(header),"unitsSold","historyFrom","fetchedAt","scope"];
 const start = "2026-01-08";
 const facets = local.inventoryFacets(entries,visibleKeys,start,start);
 assert.deepEqual(Object.keys(facets),visibleKeys);
 assert.deepEqual(facets["csv:Condition"],["Lightly Played","Near Mint"]);
 assert.deepEqual(facets["csv:Printing"],["Foil","Normal"]);
 assert.deepEqual(facets["csv:Language"],["English","Japanese"]);
 assert.deepEqual(facets["csv:Tags"],["001","1"]);
 assert.deepEqual(facets[domain.csvColumnKey(header)],["Shelf A","Shelf B"]);
 assert.deepEqual(facets.unitsSold,[0,3,8]);
 assert.deepEqual(facets.historyFrom,[Date.UTC(2026,0,1)]);
 assert.deepEqual(facets.scope,["Product"]);
 assert.deepEqual(await data.facets(owner,{keys:visibleKeys,dateFrom:start,dateTo:start}),facets);

 const filters = {...domain.emptyFilters,dateFrom:start,dateTo:start,categories:{
  "csv:Tags":["001"],
  "csv:Condition":["Near Mint"],
  [domain.csvColumnKey(header)]:["Shelf A"],
  unitsSold:[0],
 }};
 const query = {filters};
 assert.deepEqual(local.queryLocalInventory(entries,query,24).rows.map(row=>row["csv:Lookup"]),["11"]);
 assert.deepEqual((await data.queryCards(owner,query)).rows.map(row=>row["csv:Lookup"]),["11"]);
 const localCsv = await local.localExport(entries,query,initial.headers,24,false).text();
 const serverCsv = await (await data.exportInventory(owner,query)).text();
 assert.deepEqual(csv.parseCSV(localCsv),csv.parseCSV(serverCsv));
 assert.equal(csv.parseCSV(serverCsv).records.length,1);
 const saved = await data.savePreferences(owner,{settings:{currentView:{...initial.settings.currentView,filters}},settingsOnly:true});
 assert.deepEqual(saved.settings.currentView.filters.categories,filters.categories);
});
