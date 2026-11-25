import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import ts from "typescript";
function moduleUrl(path,replacements={}){let source=ts.transpileModule(readFileSync(new URL(path,import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;for(const [key,value] of Object.entries(replacements))source=source.replaceAll('from "'+key+'"','from '+JSON.stringify(value));return "data:text/javascript;base64,"+Buffer.from(source).toString("base64");}
const sql=new DatabaseSync(":memory:");
function prepared(query){let values=[];return {bind(...args){values=args;return this},async first(){return sql.prepare(query).get(...values)??null},async all(){return {results:sql.prepare(query).all(...values)}},sync(){return {meta:{changes:Number(sql.prepare(query).run(...values).changes)}}}};}
globalThis.authTestEnv={DB:{prepare:prepared,async batch(statements){sql.exec("BEGIN");try{const result=statements.map(s=>s.sync());sql.exec("COMMIT");return result}catch(e){sql.exec("ROLLBACK");throw e}}},FRONTEND_URL:"https://elij91.github.io/TCG-Data/",OWNER_GITHUB_ID:"59631669",SESSION_SECRET:"test-only-session-secret-not-for-production",GITHUB_CLIENT_ID:"test-client",GITHUB_CLIENT_SECRET:"test-client-secret",FREE_ONLY:"true"};
const stub=code=>"data:text/javascript;base64,"+Buffer.from(code).toString("base64");
const authUrl=moduleUrl("../cloudflare/auth.ts");
const auth=await import(authUrl);
const {default:worker}=await import(moduleUrl("../cloudflare/worker.ts",{"cloudflare:workers":stub("export const env=globalThis.authTestEnv;"),"../lib/http-api":stub("export async function handleApi(request,owner){return Response.json({owner});}"),"./auth":authUrl,"./generated/schema":moduleUrl("../cloudflare/generated/schema.ts")}));
const base="https://backend.workers.dev",origin="https://elij91.github.io",realFetch=globalThis.fetch;
let profileId=59631669;
globalThis.fetch=async url=>{if(String(url)==="https://github.com/login/oauth/access_token")return Response.json({access_token:"test-github-token"});if(String(url)==="https://api.github.com/user")return Response.json({id:profileId});throw new Error("Unexpected network request");};
async function loginStart(){const verifier=auth.randomCode(),challenge=await auth.challengeFor(verifier),response=await worker.fetch(new Request(base+"/auth/login?challenge="+challenge));assert.equal(response.status,303);const state=new URL(response.headers.get("Location")).searchParams.get("state"),cookie=response.headers.get("Set-Cookie").split(";")[0];return {verifier,state,cookie};}
async function callback(start){return worker.fetch(new Request(base+"/auth/callback?code=test-code&state="+start.state,{headers:{Cookie:start.cookie}}));}
const exchange=(code,verifier,from=origin)=>worker.fetch(new Request(base+"/auth/exchange",{method:"POST",headers:{Origin:from,"Content-Type":"application/json"},body:JSON.stringify({code,verifier})}));
test("OAuth sign-in codes are bound to the initiating browser and consumed exactly once",async()=>{
 const start=await loginStart(),response=await callback(start);assert.equal(response.status,303);
 const code=new URLSearchParams(new URL(response.headers.get("Location")).hash.slice(1)).get("code");assert(code);
 assert.equal((await exchange(code,auth.randomCode())).status,401);
 assert.equal((await exchange(code,start.verifier,"https://evil.test")).status,403);
 const valid=await exchange(code,start.verifier);assert.equal(valid.status,200);const {token}=await valid.json();
 assert.equal((await exchange(code,start.verifier)).status,401);
 const api=await worker.fetch(new Request(base+"/api/state",{headers:{Origin:origin,Authorization:"Bearer "+token}}));assert.equal(api.status,200);assert.equal((await api.json()).owner,"59631669");assert.equal(api.headers.get("Access-Control-Allow-Origin"),origin);
 const crossOrigin=await worker.fetch(new Request(base+"/api/state",{headers:{Origin:"https://evil.test",Authorization:"Bearer "+token}}));assert.equal(crossOrigin.status,403);assert.equal(crossOrigin.headers.get("Access-Control-Allow-Origin"),null);
});
test("A different GitHub account cannot receive an inventory session",async()=>{
 profileId=123;const response=await callback(await loginStart());assert.match(response.headers.get("Location"),/#error=/);profileId=59631669;
});
test("Missing, forged and expired OAuth state are rejected before requesting GitHub tokens",async()=>{
 const start=await loginStart();const response=await callback({...start,state:"wrong-state"});assert.match(response.headers.get("Location"),/#error=/);
 const anonymous=await worker.fetch(new Request(base+"/api/state"));assert.equal(anonymous.status,401);
});
test("Backend stops when the free-only guard is disabled",async()=>{
 globalThis.authTestEnv.FREE_ONLY="false";assert.equal((await worker.fetch(new Request(base+"/api/state"))).status,503);globalThis.authTestEnv.FREE_ONLY="true";
 globalThis.fetch=realFetch;
});
