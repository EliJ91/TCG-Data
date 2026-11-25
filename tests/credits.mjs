import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {readFileSync,readdirSync} from "node:fs";
import ts from "typescript";
function url(path,replacements={}) {let s=ts.transpileModule(readFileSync(new URL(path,import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;for(const [k,v]of Object.entries(replacements))s=s.replaceAll('from "'+k+'"','from '+JSON.stringify(v));return "data:text/javascript;base64,"+Buffer.from(s).toString("base64");}
const sql=new DatabaseSync(":memory:");
for(const f of readdirSync(new URL("../drizzle",import.meta.url)).filter(f=>f.endsWith(".sql")).sort())sql.exec(readFileSync(new URL("../drizzle/"+f,import.meta.url),"utf8"));
function statement(query) {let args=[];return {bind(...values){args=values;return this},async first(){return sql.prepare(query).get(...args)??null},async all(){return {results:sql.prepare(query).all(...args)}},async run(){const r=sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}}},sync(){const r=sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}}}};}
globalThis.testDB={prepare:statement,async batch(statements){sql.exec("BEGIN IMMEDIATE");try{const result=statements.map(s=>s.sync());sql.exec("COMMIT");return result}catch(e){sql.exec("ROLLBACK");throw e}}};
const stub="data:text/javascript;base64,"+Buffer.from(`export class AppError extends Error {constructor(message,status){super(message);this.status=status}}; export const database=()=>globalThis.testDB,apiKey=async()=>"test-key-not-real",workspace=async(owner)=>({owner});`).toString("base64");
const adapter=url("../lib/api-sh.ts");
const credits=await import(url("../lib/credits.ts",{"./data":stub,"./api-sh":adapter}));
const market=await import(url("../lib/market.ts",{"./data":"data:text/javascript;base64,"+Buffer.from(`export class AppError extends Error {};export const database=()=>globalThis.testDB;export const apiKey=async()=>"test",workspace=async()=>({}),preferences=()=>({}),buildQuery=()=>({});`).toString("base64"),"./api-sh":adapter,"./credits":url("../lib/credits.ts",{"./data":stub,"./api-sh":adapter})}));
let dailyLimit=null,dailyUsed=0,free=3,reset=new Date(Date.now()+30*86400000).toISOString(),calls=[];
const realFetch=globalThis.fetch;
globalThis.fetch=async (url)=>{calls.push(String(url));return Response.json({account:{id:"shared",status:"active"},credits:{free,total:free+10000,payg:10000,free_resets_at:reset},spend:{this_month:0,today:dailyUsed,monthly_limit:1000,daily_limit:dailyLimit,period:"UTC"}})};
function run(id,owner="owner",budget=3){sql.prepare("INSERT OR IGNORE INTO workspaces (owner) VALUES (?)").run(owner);sql.prepare("INSERT INTO refresh_runs(id,owner,status,started_at,total,detail) VALUES (?,?,'running',?,10,?)").run(id,owner,Date.now(),JSON.stringify({maximumCredits:budget}));}
test("D1 atomic reservations prevent concurrent requests spending purchased credits",async()=>{
 run("concurrent");await credits.syncAccount("owner");
 const results=await Promise.allSettled(Array.from({length:12},()=>credits.reserveCredits("owner","concurrent","/history",1)));
 const accepted=results.filter(r=>r.status==="fulfilled").map(r=>r.value);
 assert(accepted.length>0&&accepted.length<=3);
 const state=sql.prepare("SELECT * FROM credit_accounts WHERE id='shared'").get();assert(state.available>=0);assert(state.available+state.reserved<=3);
 for(const r of accepted)await credits.settleCredits(r,new Response(null,{status:404,headers:{"x-credits-used":"1","x-request-id":crypto.randomUUID()}}),{credits_used:1},"owner");
 const requests=sql.prepare("SELECT * FROM api_requests").all();assert(requests.every(r=>r.charged===1&&r.status==="error"));
 // A stale account response cannot restore already spent credits during the same period.
 const prior=sql.prepare("SELECT available FROM credit_accounts").get().available;await credits.syncAccount("owner");assert.equal(sql.prepare("SELECT available FROM credit_accounts").get().available,prior);
});
test("Approved refresh cost is independently enforced atomically",async()=>{
 reset=new Date(Date.now()+31*86400000).toISOString();free=5;run("capped","owner",1);await credits.syncAccount("owner");
 const r=await credits.reserveCredits("owner","capped","/history",1);await credits.settleCredits(r,new Response(null,{headers:{"x-credits-used":"1"}}),{},"owner");
 await assert.rejects(()=>credits.reserveCredits("owner","capped","/extra",1),/Not enough verified free credits/);
});
test("UTC provider reset permits incremental analysis without deleting previous requests",async()=>{
 const count=sql.prepare("SELECT COUNT(*) AS count FROM api_requests").get().count;
 reset=new Date(Date.now()+60*86400000).toISOString();free=7;const snapshot=await credits.syncAccount("owner");assert.equal(snapshot.available,7);assert.equal(sql.prepare("SELECT COUNT(*) AS count FROM api_requests").get().count,count);
});
test("Unknown request outcome is conservatively accounted and blocks until free reconciliation",async()=>{
 run("timeout","owner",2);const r=await credits.reserveCredits("owner","timeout","/history",1);await credits.settleCredits(r,null,{},"owner");
 assert.equal(sql.prepare("SELECT dirty FROM credit_accounts").get().dirty,1);assert.equal(sql.prepare("SELECT charged FROM api_requests WHERE id=?").get(r.id).charged,1);
 free=6;await credits.syncAccount("owner");assert.equal(sql.prepare("SELECT dirty FROM credit_accounts").get().dirty,0);
});

test("Provider daily limit resets do not permanently exhaust the monthly free bucket",async()=>{
 reset=new Date(Date.now()+75*86400000).toISOString();free=6;dailyLimit=1;dailyUsed=1;
 const capped=await credits.syncAccount("owner");assert.equal(capped.available,0);
 dailyUsed=0;const nextDay=await credits.syncAccount("owner");assert.equal(nextDay.available,1);
 assert.equal(sql.prepare("SELECT available FROM credit_accounts").get().available,6);
 dailyLimit=null;
});
test("Provider cache avoids repeated paid calls and failed lookups retain charges and request IDs",async()=>{
 reset=new Date(Date.now()+90*86400000).toISOString();free=10;run("provider","owner",3);let paid=0;
 const accountFetch=globalThis.fetch;
 globalThis.fetch=async(url)=>{
   if(String(url).includes("/v1/account"))return accountFetch(url);
   paid++;free--;
   if(String(url).includes("id=999"))return Response.json({error:"not found",credits_used:1},{status:404,headers:{"x-credits-used":"1","x-request-id":crypto.randomUUID()}});
   return Response.json({product_id:123,range:"month",currency:"USD",series:[],credits_used:1},{headers:{"x-credits-used":"1","x-request-id":crypto.randomUUID()}});
 };
 const path="/tcgplayer/v1/price-history?id=123&range=month";
 await market.provider("owner","provider","test",path,24);
 await market.provider("owner","provider","test",path,24);
 assert.equal(paid,1,"fresh local cache must eliminate the second charge");
 await assert.rejects(()=>market.provider("owner","provider","test","/tcgplayer/v1/price-history?id=999&range=month",24),/HTTP 404/);
 assert.equal(paid,2,"charged failures must not be retried automatically");
 const record=sql.prepare("SELECT * FROM api_requests WHERE run_id='provider' AND status='error'").get();assert.equal(record.charged,1);assert(record.request_id);
 assert.equal(sql.prepare("SELECT spent FROM refresh_runs WHERE id='provider'").get().spent,2);
 globalThis.fetch=accountFetch;
});
test("Free result recovery never counts original credits_used as another charge",async()=>{
 const row=sql.prepare("SELECT * FROM api_requests WHERE run_id='provider' AND status='ok'").get();
 const spent=sql.prepare("SELECT SUM(charged) AS spent FROM api_requests").get().spent;
 globalThis.fetch=async(url)=>{assert(String(url).includes("/v1/results/"));return Response.json({product_id:123,range:"month",currency:"USD",series:[],credits_used:1},{headers:{"x-refetch":"1"}})};
 const result=await market.recoverResult("owner",row.id);assert.equal(result.creditsUsed,0);
 assert.equal(sql.prepare("SELECT SUM(charged) AS spent FROM api_requests").get().spent,spent);
 globalThis.fetch=realFetch;
});
