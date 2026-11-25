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
const data=await import(moduleUrl("../lib/data.ts",{"cloudflare:workers":"data:text/javascript,export const env=globalThis.inventoryTestEnv;","./domain":domainUrl,"./csv":csvUrl}));
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
