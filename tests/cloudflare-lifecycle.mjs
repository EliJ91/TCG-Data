import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import ts from "typescript";

const stub=code=>"data:text/javascript;base64,"+Buffer.from(code).toString("base64");
function moduleUrl(path,replacements={}){
 let source=ts.transpileModule(readFileSync(new URL(path,import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 for(const [key,value] of Object.entries(replacements))source=source.replaceAll('from "'+key+'"','from '+JSON.stringify(value));
 return stub(source);
}
const authUrl=moduleUrl("../cloudflare/auth.ts"),auth=await import(authUrl);
const secret="test-only-session-secret-not-for-production",owner="59631669";
const token=await auth.sign({kind:"session",owner,exp:Date.now()+3600000},secret);
globalThis.lifecycleTestEnvs=new Map();
async function loadWorker(DB){
 const id=crypto.randomUUID();
 globalThis.lifecycleTestEnvs.set(id,{DB,FRONTEND_URL:"https://elij91.github.io/TCG-Data/",OWNER_GITHUB_ID:owner,SESSION_SECRET:secret,FREE_ONLY:"true"});
 return (await import(moduleUrl("../cloudflare/worker.ts",{
  "cloudflare:workers":stub("export const env=globalThis.lifecycleTestEnvs.get("+JSON.stringify(id)+");"),
  "../lib/http-api":stub("export async function handleApi(request,owner){return Response.json({owner});}"),
  "./auth":authUrl,"./generated/schema":moduleUrl("../cloudflare/generated/schema.ts"),
 }))).default;
}
const request=()=>new Request("https://backend.workers.dev/api/state",{headers:{Authorization:"Bearer "+token,Origin:"https://elij91.github.io"}});
async function within(promise){
 let timer;
 try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("Request waited for another request's unfinished work")),1000);})]);}
 finally{clearTimeout(timer);}
}

test("A new request completes when the first request's schema lookup never settles",async()=>{
 let calls=0,started;
 const firstStarted=new Promise(resolve=>{started=resolve;});
 const worker=await loadWorker({prepare(){return {first(){calls++;if(calls===1){started();return new Promise(()=>{});}return Promise.resolve({name:"refresh_owner_started"});}};}});
 void worker.fetch(request());
 await firstStarted;
 assert.equal((await within(worker.fetch(request()))).status,200);
 assert.equal(calls,2);
 assert.equal((await within(worker.fetch(request()))).status,200);
 assert.equal(calls,2,"Later requests reuse completed state without retaining a promise");
});

test("A failed initialization is retried by the next request",async()=>{
 let calls=0;
 const worker=await loadWorker({prepare(){return {async first(){if(++calls===1)throw Error("Temporary D1 lookup failure");return {name:"refresh_owner_started"};}};}});
 assert.equal((await worker.fetch(request())).status,503);
 assert.equal((await worker.fetch(request())).status,200);
 assert.equal(calls,2);
});

test("Existing databases add the read indexes without rebuilding inventory", async () => {
 const sql = new DatabaseSync(":memory:");
 const {schema,refreshReadSchema} = await import(moduleUrl("../cloudflare/generated/schema.ts"));
 for (const statement of schema.filter(statement=>!refreshReadSchema.includes(statement))) sql.exec(statement);
 sql.prepare("INSERT INTO workspaces(owner) VALUES (?)").run(owner);
 let upgrades = 0;
 const worker = await loadWorker({
  prepare(query) { return {query, async first() { return sql.prepare(query).get(); }}; },
  async batch(statements) {
   upgrades++;
   for (const statement of statements) sql.exec(statement.query);
  },
 });
 assert.equal((await worker.fetch(request())).status,200);
 assert(sql.prepare("SELECT name FROM sqlite_master WHERE name='cards_version_product'").get());
 assert(sql.prepare("SELECT owner FROM workspaces WHERE owner=?").get(owner));
 assert.equal((await worker.fetch(request())).status,200);
 assert.equal(upgrades,1);
 sql.close();
});

test("Concurrent cold requests initialize an empty database atomically without duplicate-table errors",async()=>{
 const sql=new DatabaseSync(":memory:");
 let lookups=0,release;
 const bothStarted=new Promise(resolve=>{release=resolve;});
 const worker=await loadWorker({
  prepare(query){return {query,async first(){if(++lookups===2)release();await bothStarted;return null;}};},
  async batch(statements){sql.exec("BEGIN");try{for(const s of statements)sql.exec(s.query);sql.exec("COMMIT");}catch(error){sql.exec("ROLLBACK");throw error;}},
 });
 const responses=await within(Promise.all([worker.fetch(request()),worker.fetch(request())]));
 assert.deepEqual(responses.map(r=>r.status),[200,200]);
 assert(sql.prepare("SELECT name FROM sqlite_master WHERE name='auth_codes'").get());
 assert.equal((await worker.fetch(request())).status,200);
 assert.equal(lookups,2);
 sql.close();
});
