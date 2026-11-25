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
function statement(query){let args=[];return {bind(...values){args=values;return this},async first(){return sql.prepare(query).get(...args)??null},async all(){return {results:sql.prepare(query).all(...args)}},async run(){return this.sync()},sync(){return {meta:{changes:Number(sql.prepare(query).run(...args).changes)}}}};}
globalThis.inventoryTestEnv={DB:{prepare:statement,async batch(statements){sql.exec("BEGIN");try{const results=statements.map(s=>s.sync());sql.exec("COMMIT");return results}catch(e){sql.exec("ROLLBACK");throw e}}}};
const domainUrl=moduleUrl("../lib/domain.ts"),csvUrl=moduleUrl("../lib/csv.ts",{"./domain":domainUrl});
const csv=await import(csvUrl),domain=await import(domainUrl);
const dataUrl=moduleUrl("../lib/data.ts",{"cloudflare:workers":"data:text/javascript,export const env=globalThis.inventoryTestEnv;","./domain":domainUrl,"./csv":csvUrl});
const data=await import(dataUrl);
const adapterUrl=moduleUrl("../lib/api-sh.ts"),creditsUrl=moduleUrl("../lib/credits.ts",{"./data":dataUrl,"./api-sh":adapterUrl});
const market=await import(moduleUrl("../lib/market.ts",{"./data":dataUrl,"./api-sh":adapterUrl,"./credits":creditsUrl}));
const owner="inventory-test";
async function upload(text,mode="replace") {
 const prepared=csv.prepareImport(text,{productId:"Lookup"});
 const {id}=await data.startImport(owner,{mode,filename:"qa-simple.csv",headers:prepared.headers,count:prepared.rows.length});
 await data.uploadChunk(owner,id,0,prepared.rows);
 return data.commitImport(owner,id);
}
test("Arbitrary CSV rows, duplicate product IDs and original headers survive import, search, sort and export",async()=>{
 const realFetch=globalThis.fetch;
 globalThis.fetch=async()=>{throw new Error("Import and browsing must not request provider data");};
 try {
 const header=`Odd ' " header`;
 const input=[['Lookup','My label',header,'Market price'],['123','First','0005','original'],['123','Second','keep, this',''],['456','Third','0001','source price']].map(row=>row.map(csv.csvCell).join(',')).join('\n');
 const state=await upload(input);
 assert.equal(state.uniqueCards,3);
 let result=await data.queryCards(owner,{sort:"rowNo",direction:"asc"});
 assert.equal(result.rows.length,3);assert.equal(result.rows[0]['csv:My label'],'First');assert.equal(result.rows[1]['csv:My label'],'Second');
 assert.equal(result.rows[0]['csv:'+header],'0005');assert.equal(result.rows[0].marketPrice,null);
 assert.equal((await data.queryCards(owner,{filters:{search:'keep, this'}})).matches,1);
 assert.equal((await data.queryCards(owner,{sort:'csv:'+header,direction:'asc'})).rows[0]['csv:My label'],'Third');
 const original=await (await data.exportInventory(owner,{})).text();
 assert.deepEqual(csv.parseCSV(original),csv.parseCSV(input));
 const appended=csv.parseCSV(await (await data.exportInventory(owner,{analysis:true,sort:"rowNo",direction:"asc"})).text());
 assert.deepEqual(appended.headers.slice(0,4),['Lookup','My label',header,'Market price']);
 assert(appended.headers.includes('Market data · Market price'));
 assert.equal(appended.records[1][1],'Second');
 } finally {globalThis.fetch=realFetch;}
});
test("Column choices and order persist through later uploads, including temporarily absent headers",async()=>{
 const chosen=['units30','csv:My label','csv:Lookup'];
 await data.savePreferences(owner,{settings:{visibleColumns:chosen,columnSelectionVersion:1}});
 let state=await upload('Lookup,My label,New field\n123,Updated,value');
 assert.deepEqual(state.settings.visibleColumns,['csv:New field',...chosen]);
 assert(!state.settings.visibleColumns.includes(`csv:Odd ' " header`));
 state=await upload('Lookup,Other\n789,replacement');
 assert(state.settings.visibleColumns.includes('csv:My label'));
 state=await upload('Lookup,My label\n123,Back');
 assert(state.settings.visibleColumns.includes('csv:My label'));
 assert((await data.state(owner)).settings.visibleColumns.includes('units30'));
});
test("Rows with no name or quantity import and repeated updates retain row count",async()=>{
 await upload('Lookup,Custom\n123,one\n123,two');
 await upload('Lookup,Custom\n123,changed\n123,two','update');
 const state=await upload('Lookup,Custom\n123,changed\n123,two','update');
 assert.equal(state.uniqueCards,2);
 const rows=(await data.queryCards(owner,{sort:'rowNo',direction:'asc'})).rows;
 assert.deepEqual(rows.map(row=>row['csv:Custom']),['changed','two']);
});
test("Only monthly sales history can be charged, including old saved options and old refresh runs",async()=>{
 const realFetch=globalThis.fetch,paid=[];
 globalThis.inventoryTestEnv.API_SH_API_KEY="local-test-only-key";
 const history=id=>({product_id:Number(id),range:"month",currency:"USD",series:[{sku:77,points:[]}],credits_used:1});
 globalThis.fetch=async input=>{
   const url=new URL(String(input));
   if(url.pathname==="/v1/account")return Response.json({account:{id:"sales-test",status:"active"},credits:{free:1000,total:2000,payg:1000,free_resets_at:new Date(Date.now()+30*86400000).toISOString()},spend:{this_month:0,today:0,monthly_limit:1000,daily_limit:null,period:"UTC"}});
   assert.equal(url.pathname,"/tcgplayer/v1/price-history");assert.equal(url.searchParams.get("range"),"month");
   paid.push(url.href);return Response.json(history(url.searchParams.get("id")),{headers:{"x-credits-used":"1","x-request-id":crypto.randomUUID()}});
 };
 try {
   await upload('Lookup,Custom\n123,one\n123,two\n456,three');
   const state=await data.savePreferences(owner,{settings:{historyRange:"annual",includePricing:true,includeListings:true}});
   assert.equal(state.settings.historyRange,"month");assert.equal(state.settings.includePricing,false);assert.equal(state.settings.includeListings,false);
   const rows=(await data.queryCards(owner,{})).rows;
   for(const row of rows.filter(row=>row.productId==='123'))sql.prepare("INSERT INTO market(id,owner,card_key,product_id,fetched_at,data,detail) VALUES (?,?,?,?,?,?,?)").run(owner+'|'+row.key,owner,row.key,'123',Date.now(),JSON.stringify({analyzed:true,available:true,granularity:'weekly'}),'{}');
   const path='/tcgplayer/v1/price-history?id=123&range=month',fetchedAt=Date.now()-1000;
   sql.prepare("INSERT INTO api_cache(id,owner,fetched_at,data) VALUES (?,?,?,?)").run(owner+'|api-sh:'+path,owner,fetchedAt,JSON.stringify({body:history(123),requestId:'cached',fetchedAt,path}));
   const input={onlyStale:true,range:'annual',includePricing:true,includeListings:true,maxProducts:100};
   const plan=await market.refreshPlan(owner,input);
   assert.equal(plan.groups,2);assert.equal(plan.maximumCredits,1);assert.equal(paid.length,0);
   assert.equal(plan.options.range,'month');assert.equal(plan.options.includePricing,false);assert.equal(plan.options.includeListings,false);
   const started=await market.startRefresh(owner,{...input,approvedCost:1});
   sql.prepare("UPDATE refresh_runs SET detail=json_set(detail,'$.options.range','annual','$.options.includePricing',1,'$.options.includeListings',1) WHERE id=?").run(started.id);
   for(const key of started.keys){const result=await market.refreshStep(owner,started.id,key);assert.equal(result.error,undefined);}
   assert.equal(paid.length,1);assert(paid[0].includes('id=456'));
   assert((await data.queryCards(owner,{})).rows.every(row=>row.granularity==='daily'));
   assert.equal((await market.refreshPlan(owner,input)).groups,0);
   const charged=sql.prepare("SELECT COUNT(*) AS total FROM api_requests").get().total;
   await assert.rejects(()=>market.provider(owner,started.id,'test','/tcgplayer/v1/product?id=123',24),/Only monthly/);
   await assert.rejects(()=>market.provider(owner,started.id,'test','/tcgplayer/v1/listings?id=123',24),/Only monthly/);
   assert.equal(sql.prepare("SELECT COUNT(*) AS total FROM api_requests").get().total,charged);
 } finally {globalThis.fetch=realFetch;delete globalThis.inventoryTestEnv.API_SH_API_KEY;}
});
