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

test("Replacing a CSV retains and restores product sales while hiding removed cards", async () => {
 const owner = "replacement-history-test";
 const requests = [];
 const fetchOriginal = globalThis.fetch;
 globalThis.fetch = async input => {
  const path = new URL(String(input)).pathname;
  requests.push(path);
  assert.equal(path,"/v1/account");
  return Response.json({
   account:{id:"replacement-test",status:"active"},
   credits:{free:10,free_resets_at:new Date(Date.now()+86400000).toISOString()},
   spend:{this_month:0,monthly_limit:10,period:"UTC"},
  });
 };
 const replace = async (csvText, prev = null) => {
  const prepared = csv.prepareImport(csvText,{productId:"Lookup"});
  const {id}=await data.startImport(owner,{mode:"replace",filename:"new.csv",headers:prepared.headers,count:prepared.rows.length});
  await data.uploadChunk(owner,id,0,prepared.rows);
  await data.commitImport(owner,id,true);
  return clientSync.synchronizeInventory((route) => {
   const [path,query]=route.split("?");
   const params=new URLSearchParams(query);
   if (path==="sync/meta") return sync.syncMetadata(owner,params.get("version"));
   assert.equal(path,"sync/inventory");
   return sync.syncInventory(owner,params);
  },owner,prev);
 };
 const visible = snapshot => local.queryLocalInventory(local.indexInventory(snapshot.cards),{sort:"rowNo",direction:"asc"},24)
  .rows.map(row=>[row.productId,row["csv:Name"],row.unitsSold]);
 const insert=sql.prepare("INSERT INTO market(id,owner,card_key,product_id,fetched_at,data,detail) VALUES (?,?,?,?,?,?,?)");
 const date=Date.UTC(2026,0,8);
 const history=(id,key,units) => insert.run(owner+"|"+key,owner,key,id,date,
  JSON.stringify({available:true,analyzed:true,scope:"Product",unitsSold:units,historyFrom:date,historyTo:date}),
  JSON.stringify({history:[{date,units}]}));
 try {
  const initial=await replace("Lookup,Name\n101,Original name\n102,To remove\n103,Legacy card");
  history("101","product:101|row:0",7);
  history("102","product:102|row:0",4);
  history("103","product:103|row:2",0);
  const replacement=await replace("Lookup,Name\n104,New card\n00101,Changed name",initial);
  assert.deepEqual(visible(replacement),[["104","New card",null],["101","Changed name",7]]);
  assert.equal(sql.prepare("SELECT COUNT(*) AS count FROM market WHERE owner=?").get(owner).count,3);
  assert.deepEqual((await data.queryCards(owner,{sort:"rowNo",direction:"asc"})).rows.map(row=>row.productId),["104","101"]);
  const returned=await replace("Lookup,Name\n102,Returned\n103,Legacy returned\n104,Still new",replacement);
  assert.deepEqual(visible(returned),[["102","Returned",4],["103","Legacy returned",0],["104","Still new",null]]);
  assert.equal(sql.prepare("SELECT COUNT(*) AS count FROM market WHERE owner=?").get(owner).count,4);
  assert.deepEqual(requests,[]);
  globalThis.inventoryTestEnv.API_SH_API_KEY="fixture";
  assert.deepEqual((await market.refreshPlan(owner,{mode:"missing"})).keys,["product:104|row:0"]);
  assert.equal((await market.refreshPlan(owner,{mode:"all"})).groups,3);
  assert(requests.every(path=>path==="/v1/account"));
 } finally {
  globalThis.fetch=fetchOriginal;
  delete globalThis.inventoryTestEnv.API_SH_API_KEY;
 }
});

test("Selected CSV cells save in place and sync to other devices and CSV exports", async () => {
 const owner = "bulk-edit-test", requests = [];
 const prepared = csv.prepareImport("Lookup,Name,Quantity,Tags\n101,One,2,old\n102,Two,4,old\n103,Three,1,keep",{productId:"Lookup"});
 const {id:version} = await data.startImport(owner,{mode:"replace",filename:"edit.csv",headers:prepared.headers,count:3});
 await data.uploadChunk(owner,version,0,prepared.rows);
 await data.commitImport(owner,version,true,"Lookup");
 const [first,second,third] = prepared.rows.map(row => row.info.key);
 const insert = sql.prepare("INSERT INTO market(id,owner,card_key,product_id,fetched_at,data,detail) VALUES (?,?,?,?,?,?,?)");
 insert.run(owner+"|"+first,owner,first,"101",100,JSON.stringify({analyzed:true,available:true,unitsSold:9}),"{}");
 const returned = "product:104|row:0";
 insert.run(owner+"|"+returned,owner,returned,"104",100,JSON.stringify({analyzed:true,available:true,unitsSold:6}),"{}");
 const api = route => {
  const [name,search] = route.split("?");
  const params = new URLSearchParams(search);
  requests.push(name);
  if (name==="sync/meta") return sync.syncMetadata(owner,params.get("version"));
  if (name==="sync/inventory") return sync.syncInventory(owner,params);
  assert.equal(name,"sync/changes");
  return sync.syncChanges(owner,params);
 };
 let cached = await clientSync.synchronizeInventory(api,owner,null);
 requests.length = 0;
 const edit = (keys,column,value,inputVersion=version) => data.editInventory(owner,{version:inputVersion,keys,column,value});
 const tag = 'listed, "ready"\nNext shelf';
 assert.equal((await edit([first,second,first],"Tags",tag)).changed,2);
 await assert.rejects(sync.syncChanges(owner,new URLSearchParams({after:String(cached.meta.sequence),through:String((await sync.syncMetadata(owner,version)).sequence)})),{status:409});
 assert.equal((await edit([first,second],"Tags",tag)).changed,0);
 assert.equal((await edit([first],"Quantity","1,200")).changed,1);
 await edit([second],"Name","Renamed Two");
 await assert.rejects(edit([third,"missing"],"Tags","unapplied"),{status:409});
 await assert.rejects(edit([third],"Tags","old version","old"),{status:409});
 await assert.rejects(edit([third],"unitsSold","123"),{status:400});
 await assert.rejects(edit([first,second],"Lookup","104"),{status:400});
 await assert.rejects(edit([first],"Lookup","102"),/already in the inventory/);
 cached = await clientSync.synchronizeInventory(api,owner,cached);
 assert.deepEqual(requests.splice(0),["sync/meta","sync/changes"]);
 const rows = snapshot => local.queryLocalInventory(local.indexInventory(snapshot.cards),
  {sort:"rowNo",direction:"asc"},24).rows;
 assert.deepEqual(rows(cached).map(row=>[row["csv:Tags"],row.quantity,row.name,row.unitsSold]),
  [[tag,1200,"One",9],[tag,4,"Renamed Two",null],["keep",1,"Three",null]]);
 const exported = async result => csv.parseCSV(await result.text()).records;
 const nextCsv = [["101","One","1,200",tag],["102","Renamed Two","4",tag],["103","Three","1","keep"]];
 assert.deepEqual(await exported(await data.exportInventory(owner,{})),nextCsv);
 assert.deepEqual(await exported(local.localExport(local.indexInventory(cached.cards),{},prepared.headers,24,false)),nextCsv);
 const updated = await edit([first],"Lookup","https://www.tcgplayer.com/product/000104/card");
 assert.equal(updated.newKey,returned);
 await edit([second],"Tags","");
 const previous = cached;
 cached = await clientSync.synchronizeInventory(api,owner,cached);
 assert.deepEqual(rows(cached).map(row=>[row.key,row["csv:Tags"],row.unitsSold]),
  [[returned,tag,6],[second,"",null],[third,"keep",null]]);
 assert.strictEqual(cached.cards.find(row=>row.key===third),previous.cards.find(row=>row.key===third));
 assert.equal(sql.prepare("SELECT COUNT(*) AS count FROM market WHERE owner=?").get(owner).count,2);
});

test("Single and bulk deletion remove saved CSV rows and keep product sales", async () => {
 const owner = "delete-rows-test", requests = [];
 const filename = "delete.csv";
 const uploadRows = async (account, csvText, mode = "replace") => {
  const prepared = csv.prepareImport(csvText,{productId:"Lookup"});
  const {id} = await data.startImport(account,{mode,filename,headers:prepared.headers,count:prepared.rows.length});
  await data.uploadChunk(account,id,0,prepared.rows);
  await data.commitImport(account,id,true,"Lookup");
  return id;
 };
 const header = "Lookup,Name";
 const version = await uploadRows(owner,header+"\n101,One\n102,Two\n103,Three");
 const anotherOwner = "delete-rows-other-owner";
 await uploadRows(anotherOwner,header+"\n101,Separate inventory");
 const first = "product:101|row:0", second = "product:102|row:0", third = "product:103|row:0";
 sql.prepare("INSERT INTO market(id,owner,card_key,product_id,fetched_at,data,detail) VALUES (?,?,?,?,?,?,?)")
  .run(owner+"|"+first,owner,first,"101",100,JSON.stringify({analyzed:true,available:true,unitsSold:9}),"{}");
 const api = route => {
  const [name,search] = route.split("?");
  const params = new URLSearchParams(search);
  requests.push(name);
  if (name==="sync/meta") return sync.syncMetadata(owner,params.get("version"));
  if (name==="sync/inventory") return sync.syncInventory(owner,params);
  assert.equal(name,"sync/changes");
  return sync.syncChanges(owner,params);
 };
 let cached = await clientSync.synchronizeInventory(api,owner,null);
 requests.length = 0;
 const remove = (keys, activeVersion = version) => data.deleteInventory(owner,{version:activeVersion,keys});
 await assert.rejects(remove([first],"stale-version"),{status:409});
 await assert.rejects(remove([first,"missing"]),{status:409});
 await assert.rejects(remove([]),{status:400});
 assert.equal((await data.state(owner)).uniqueCards,3);
 assert.equal((await remove([first])).deleted,1);
 cached = await clientSync.synchronizeInventory(api,owner,cached);
 assert.deepEqual(cached.cards.map(card=>card.key),[second,third]);
 assert.deepEqual(requests.splice(0),["sync/meta","sync/changes"]);
 assert.deepEqual(csv.parseCSV(await (await data.exportInventory(owner,{})).text()).records,[["102","Two"],["103","Three"]]);
 assert.equal((await data.state(anotherOwner)).uniqueCards,1);

 const beforeBulk = cached;
 assert.equal((await remove([second,third,third])).deleted,2);
 assert.equal((await data.state(owner)).uniqueCards,0);
 assert.equal((await (await data.exportInventory(owner,{})).text()).trim(),header);
 cached = await clientSync.synchronizeInventory(api,owner,cached);
 assert.deepEqual(cached.cards,[]);
 assert.deepEqual(requests.splice(0),["sync/meta","sync/changes"]);
 assert.equal((await local.localExport([],{},cached.meta.headers,24,false).text()).trim(),header);

 await uploadRows(owner,header+"\n101,Restored","update");
 cached = await clientSync.synchronizeInventory(api,owner,beforeBulk);
 assert.deepEqual(requests.splice(0),["sync/meta","sync/inventory","sync/changes"]);
 const restored = local.queryLocalInventory(local.indexInventory(cached.cards),{},24).rows;
 assert.deepEqual(restored.map(row=>[row.key,row["csv:Name"],row.unitsSold]),[[first,"Restored",9]]);
});

test("CSV quantities use the chosen column independently for each uploaded row", async () => {
 const owner = "quantity-import-test";
 const headings = "Lookup,Quantity,Add to Quantity,Total Quantity,Shelf count\n";
 const first = csv.prepareImport(headings+'101,7,90,12,3\n102,8,80,0,4\n103,9,70,"1,200",5',{productId:"Lookup"});
 assert.deepEqual(first.rows.map(row=>row.info.quantity),[12,0,1200]);
 assert.equal(csv.mapColumns(["Lookup","Add to Quantity"]).quantity,"");
 const save = async (prepared, mode) => {
  const {id} = await data.startImport(owner,{mode,filename:"quantity.csv",headers:prepared.headers,count:prepared.rows.length});
  await data.uploadChunk(owner,id,0,prepared.rows);
  await data.commitImport(owner,id,true,"Lookup");
  return id;
 };
 // The server derives the count from the row's selected CSV cell.
 first.rows[0].info.quantity=999;
 await save(first,"replace");
 const second = csv.prepareImport(headings+"104,6,80,55,4",{productId:"Lookup",quantity:"Shelf count"});
 const version = await save(second,"update");
 const counts = async () => (await data.queryCards(owner,{sort:"productId",direction:"asc"})).rows.map(row=>[row.productId,row.quantity]);
 assert.deepEqual(await counts(),[["101",12],["102",0],["103",1200],["104",4]]);
 assert.equal((await data.state(owner)).totalCards,1216);
 const keys = ["product:101|row:0","product:104|row:0"];
 await data.editInventory(owner,{version,keys,column:"Shelf count",value:"16"});
 assert.deepEqual(await counts(),[["101",12],["102",0],["103",1200],["104",16]]);
 await data.editInventory(owner,{version,keys,column:"Total Quantity",value:"2"});
 assert.deepEqual(await counts(),[["101",2],["102",0],["103",1200],["104",16]]);
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
  if (query.includes('AS "historyRange" FROM cards c')) {
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

test("Avg. Daily Sold uses the selected dates and agrees across the table and exports", async () => {
 const initial = await upload("Lookup,Name\n87101,First\n87102,Zero\n87103,Missing\n87104,Incomplete");
 const first = Date.UTC(2026,0,1), second = Date.UTC(2026,0,8);
 const insert = sql.prepare("INSERT INTO market(id,owner,card_key,product_id,fetched_at,data,detail) VALUES (?,?,?,?,?,?,?)");
 for (const [id,units] of [["87101",[14,7]],["87102",[0,0]],["87104",[5,null]]]) {
  const key = "product:"+id+"|row:0";
  insert.run(owner+"|"+key,owner,key,id,second,
   JSON.stringify({available:true,granularity:"weekly",historyFrom:first,historyTo:second}),
   JSON.stringify({history:[{date:first,units:units[0]},{date:second,units:units[1]}]}));
 }
 const meta = await sync.syncMetadata(owner,null);
 const snapshot = await sync.syncInventory(owner,new URLSearchParams({version:meta.version}));
 const entries = local.indexInventory(snapshot.rows);
 const dateRange = (dateFrom,dateTo) => ({...domain.emptyFilters,dateFrom,dateTo});
 const input = {filters:dateRange("2026-01-01","2026-01-10"),sort:"avgDailySold",direction:"desc"};
 const metric = result => result.rows.map(row=>[row.productId,row.avgDailySold]);
 const both = async (query, expected) => {
  assert.deepEqual(metric(await data.queryCards(owner,query)),expected);
  assert.deepEqual(metric(local.queryLocalInventory(entries,query,24)),expected);
 };
 assert(domain.inventoryColumns(initial.headers).some(column=>column.label==="Avg. Daily Sold"));
 assert(!initial.settings.visibleColumns.includes("avgDailySold"));
 await both(input,[["87101",2],["87102",0],["87103",null],["87104",null]]);
 await both({...input,filters:dateRange("2026-01-08","2026-01-08")},[["87101",7],["87102",0],["87103",null],["87104",null]]);
 const noAverage = [["87101",null],["87102",null],["87103",null],["87104",null]];
 await both({...input,filters:dateRange("",""),displayColumns:["avgDailySold"]},noAverage);
 await both({...input,filters:dateRange("","2026-01-04")},noAverage);
 await both({...input,filters:dateRange("2026-01-04","")},noAverage);
 await both({...input,filters:{...input.filters,numeric:[{field:"avgDailySold",min:"2",max:"2"}]}},[["87101",2]]);
 await both({...input,filters:dateRange("2026-01-02","2026-01-03")},[["87101",null],["87102",null],["87103",null],["87104",null]]);
 const analysis = await local.localExport(entries,input,meta.headers,24,true).text();
 assert.deepEqual(csv.parseCSV(analysis),csv.parseCSV(await (await data.exportInventory(owner,{...input,analysis:true})).text()));
 const parsed = csv.parseCSV(analysis);
 const avg = parsed.headers.indexOf("Avg. Daily Sold");
 assert.deepEqual(parsed.records.map(row=>row[avg]),["2","0","",""]);
 assert.deepEqual(csv.parseCSV(await local.localExport(entries,input,meta.headers,24,false).text()).headers,["Lookup","Name"]);
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

test("Untagged CSV rows and inclusive price, quantity and sales ranges match on both paths",async()=>{
 const headers = ["Lookup","Tags","Your Price","Low Price","Market Price","TCG Marketplace Price","Quantity"];
 const records = [
  ["11","","$1,234.56","1.00","2.00","3.00","007"],
  ["22","listed","$1,234.57","1.00","2.00","3.00","9"],
  ["33","\t\u00A0","N/A","text","2.00","3.00","1"],
  ["44","None","$1,235.00","1.00","2.00","3.00","2"],
  ["55","listed","12junk","1.00","2.00","3.00","007"],
 ];
 await upload([headers,...records].map(row=>row.map(csv.csvCell).join(",")).join("\n"));
 await upload("Lookup,Your Price,Quantity\n66,1234.56,7","update");
 const first = Date.UTC(2026,0,1), second = Date.UTC(2026,0,8);
 const putMarket = sql.prepare("INSERT INTO market(id,owner,card_key,product_id,fetched_at,data,detail) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET fetched_at=excluded.fetched_at,data=excluded.data,detail=excluded.detail");
 for (const [id,units] of [["11",3],["66",4]]) {
  const key = "product:"+id+"|row:0";
  putMarket.run(owner+"|"+key,owner,key,id,second,JSON.stringify({unitsSold:units+10,available:true}),JSON.stringify({history:[{date:first,units:10},{date:second,units}]}));
 }
 const meta = await sync.syncMetadata(owner,null);
 const snapshot = await sync.syncInventory(owner,new URLSearchParams({version:meta.version}));
 const entries = local.indexInventory(snapshot.rows);
 const matches = async (filters, ids) => {
  const input = {filters:{...domain.emptyFilters,...filters}};
  const collect = rows => rows.map(row=>row["csv:Lookup"]).sort();
  assert.deepEqual(collect(local.queryLocalInventory(entries,input,24).rows),ids);
  assert.deepEqual(collect((await data.queryCards(owner,input)).rows),ids);
 };
 await matches({categories:{"csv:Tags":[""]}},["11","33","66"]);
 await matches({categories:{"csv:Tags":["","listed"]}},["11","22","33","55","66"]);
 await matches({categories:{"csv:Tags":["None"]}},["44"]);
 await matches({numeric:[{field:"csv:Your Price",min:"",max:"1234.56"}]},["11","66"]);
 await matches({numeric:[{field:"csv:Quantity",min:"7",max:"7"}]},["11","55","66"]);
 for (const [field,minimum] of [["csv:Low Price","1"],["csv:Market Price","2"],["csv:TCG Marketplace Price","3"]]) {
  assert(domain.isNumericFilterColumn(field));
  await matches({numeric:[{field,min:minimum,max:minimum}]},field==="csv:Low Price" ? ["11","22","44","55"] : ["11","22","33","44","55"]);
 }
 const date = "2026-01-08";
 const filters = {categories:{"csv:Tags":[""]},dateFrom:date,dateTo:date,numeric:[
  {field:"unitsSold",min:"3",max:"3"},
  {field:"csv:Your Price",min:"1234.56",max:"1234.56"},
  {field:"csv:Quantity",min:"7",max:"7"},
 ]};
 await matches(filters,["11"]);
 const input = {filters:{...domain.emptyFilters,...filters}};
 const localCsv = await local.localExport(entries,input,meta.headers,24,false).text();
 const serverCsv = await (await data.exportInventory(owner,input)).text();
 assert.deepEqual(csv.parseCSV(localCsv),csv.parseCSV(serverCsv));
 const saved = await data.savePreferences(owner,{settings:{currentView:{filters:input.filters}},settingsOnly:true});
 assert.deepEqual(saved.settings.currentView.filters.numeric,filters.numeric);
 assert.deepEqual(saved.settings.currentView.filters.categories,filters.categories);
});

test("Views omit rows with no displayed values before counting, paging, or exporting", async () => {
 const oldIds = Array.from({length:28},(_,index)=>String(90000+index));
 await upload(["Lookup,Old Title",...oldIds.map(id=>id+",Original record "+id)].join("\n"));
 await upload("Lookup,New Title,Quantity,Tags\n91001,Current record,1,\n91002,N/A, \t,\n91003,,0,","update");
 const meta = await sync.syncMetadata(owner,null);
 const snapshot = await sync.syncInventory(owner,new URLSearchParams({version:meta.version}));
 const entries = local.indexInventory(snapshot.rows);
 const filters = {...domain.emptyFilters,categories:{"csv:Tags":[""]}};
 const input = {filters,displayColumns:["csv:New Title","csv:Quantity","csv:Tags","unitsSold"],page:2,pageSize:25};
 const expected = ["91001","91003"];
 const collect = rows=>rows.map(row=>row["csv:Lookup"]).sort();
 for (const result of [local.queryLocalInventory(entries,input,24),await data.queryCards(owner,input)]) {
  assert.equal(result.matches,2);
  assert.equal(result.page,1);
  assert.deepEqual(collect(result.rows),expected);
 }
 const localCsv = await local.localExport(entries,input,meta.headers,24,false).text();
 const remoteCsv = await (await data.exportInventory(owner,input)).text();
 assert.deepEqual(csv.parseCSV(localCsv),csv.parseCSV(remoteCsv));
 assert.deepEqual(csv.parseCSV(remoteCsv).records.map(row=>row[0]).sort(),expected);
 const oldView = {filters,displayColumns:["csv:Old Title"],pageSize:50};
 assert.deepEqual(collect(local.queryLocalInventory(entries,oldView,24).rows),oldIds);
 assert.deepEqual(collect((await data.queryCards(owner,oldView)).rows),oldIds);
 assert.equal((await data.state(owner)).uniqueCards,31);
 const allCsv = await (await data.exportInventory(owner,{})).text();
 assert.equal(csv.parseCSV(allCsv).records.length,31);
});

test("Sales pull modes quote credits without a product cap and keep failed Product IDs",async()=>{
 const pullOwner="pull-modes";
 const csvText=["Lookup,Label",...Array.from({length:155},(_,index)=>(300000+index)+",Card "+index)].join("\n");
 const prepared=csv.prepareImport(csvText,{productId:"Lookup"});
 const {id:importId}=await data.startImport(pullOwner,{mode:"replace",filename:"modes.csv",headers:prepared.headers,count:prepared.rows.length});
 await data.uploadChunk(pullOwner,importId,0,prepared.rows);
 await data.commitImport(pullOwner,importId);
 const now=Date.now(), old=now-7*86400000;
 const marketInsert=sql.prepare("INSERT INTO market(id,owner,card_key,product_id,fetched_at,data,detail) VALUES (?,?,?,?,?,?,?)");
 for(const row of prepared.rows.slice(0,100)){
  marketInsert.run(pullOwner+"|"+row.info.key,pullOwner,row.info.key,row.info.productId,old,
    JSON.stringify({analyzed:true,available:true,historyRange:"annual",unitsSold:41}),"{}");
 }
 const {salesHistoryPath}=await import(adapterUrl);
 const history=id=>({product_id:Number(id),range:"annual",series:[{sku:Number(id)+100000,points:[{date:"2026-01-01",quantity_sold:9}]}]});
 const cached="300100";
 const path=salesHistoryPath(cached);
 sql.prepare("INSERT INTO api_cache(id,owner,fetched_at,data) VALUES (?,?,?,?)")
  .run(pullOwner+"|api-sh:"+path,pullOwner,old,JSON.stringify({body:history(cached),path,fetchedAt:old}));
 const failed="300101";
 const apiCalls=[];
 const realFetch=globalThis.fetch;
 globalThis.inventoryTestEnv.API_SH_API_KEY="local-test-only-key";
 globalThis.fetch=async input=>{
  const url=new URL(String(input));
  if(url.pathname==="/v1/account") return Response.json({
   account:{id:pullOwner,status:"active"},credits:{free:500-apiCalls.length,free_resets_at:new Date(now+86400000).toISOString()},
   spend:{this_month:apiCalls.length,monthly_limit:1000,period:"UTC"},
  });
  const productId=url.searchParams.get("id");
  apiCalls.push(productId);
  const headers={"x-credits-used":"1","x-request-id":crypto.randomUUID()};
  if(productId===failed) return Response.json({error:"not found"},{status:404,headers});
  return Response.json(history(productId),{headers});
 };
 try {
  const missing=await market.prepareRefreshPlan(pullOwner,{mode:"missing",maxProducts:1});
  const all=await market.prepareRefreshPlan(pullOwner,{mode:"all",maxProducts:1});
  assert.equal(missing.groups,55);
  assert.equal(missing.maximumCredits,54);
  assert.equal(all.groups,155);
  assert.equal(all.maximumCredits,155);
  assert.deepEqual(apiCalls,[],"Estimates use no sales API credits");
  await assert.rejects(()=>market.startRefresh(pullOwner,{planId:missing.planId,approvedCost:53}),{status:409});
  const started=await market.startRefresh(pullOwner,{planId:missing.planId,approvedCost:54});
  let progress;
  for (const key of started.keys) {
   progress=await market.refreshStep(pullOwner,started.id,key);
   if(progress.error){
    assert.equal(progress.productId,failed);
    assert.match(progress.error,/HTTP 404/);
   }
  }
  assert.equal(progress.status,"complete");
  assert.equal(progress.completed,55);
  assert.equal(progress.failed,1);
  assert.equal(apiCalls.length,54);
  assert(apiCalls.every(id=>Number(id)>=300101));
  assert.equal((await market.refreshPlan(pullOwner,{mode:"missing"})).groups,1);
  const saved=sql.prepare("SELECT data FROM market WHERE owner=? AND product_id=?").get(pullOwner,"300000");
  assert.equal(JSON.parse(saved.data).unitsSold,41,"Missing mode preserves previously analyzed products");
  const failure=await market.failedProducts(pullOwner,null);
  assert.deepEqual(failure.failures.map(row=>row.productId),[failed]);
  assert.deepEqual((await market.failedProducts("another-owner",null)).failures,[]);
  const quotedAll=await market.prepareRefreshPlan(pullOwner,{mode:"all",selected:[prepared.rows[100].info.key]});
  assert.equal(quotedAll.maximumCredits,1,"All mode quotes a fresh request even for cached history");
  const refresh=await market.startRefresh(pullOwner,{planId:quotedAll.planId,approvedCost:1});
  const result=await market.refreshStep(pullOwner,refresh.id,refresh.keys[0]);
  assert.equal(result.status,"complete");
  assert.equal(apiCalls.at(-1),cached);
  assert.equal((await market.failedProducts(pullOwner,null)).failures[0].productId,failed);
 } finally {
  globalThis.fetch=realFetch;
  delete globalThis.inventoryTestEnv.API_SH_API_KEY;
 }
});

test("Failed Product IDs remain accessible past the first page",async()=>{
 const owner="failure-history";
 const runId=crypto.randomUUID();
 sql.prepare("INSERT INTO refresh_runs(id,owner,status,started_at,failed,total,detail) VALUES (?,?,?,?,?,?,?)")
  .run(runId,owner,"complete",1700000000000,51,51,"{}");
 const insert=sql.prepare("INSERT INTO refresh_products(id,owner,run_id,product_id,status) VALUES (?,?,?,?,?)");
 for(let value=800000;value<800051;value++) insert.run(runId+":"+value,owner,runId,String(value),"error");
 const first=await market.failedProducts(owner,null);
 assert.equal(first.failures.length,50);
 assert(first.next);
 const older=await market.failedProducts(owner,first.next);
 assert.deepEqual(older.failures.map(row=>row.productId),["800000"]);
 assert.equal(older.next,null);
});
