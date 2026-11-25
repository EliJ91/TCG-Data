import {env} from "cloudflare:workers";
import {handleApi} from "../lib/http-api";
import {schema,refreshReadSchema,inventorySyncSchema,salesFailureSchema} from "./generated/schema";
import {allowedOrigin,authenticatedOwner,challengeFor,oauthCookie,randomCode,readOauthCookie,sign,verify} from "./auth";
let schemaReady=false;
async function ensureSchema(){
 if(schemaReady)return;
 const db=env.DB;
 if(!db)throw new Error("Database binding is missing.");
 // Cache only completed state. Pending D1 work belongs to the current request
 // and must never be shared with a later request if this one ends early.
 const existing=await db.prepare("SELECT name FROM sqlite_master WHERE name IN ('auth_codes','refresh_owner_started','resource_windows','sales_failures_owner_run') ORDER BY name DESC LIMIT 1").first<{name:string}>();
 if(existing?.name!=="sales_failures_owner_run"){
  // Initialize new databases or upgrade existing ones atomically. The final
  // index marks completion. IF NOT EXISTS handles concurrent cold starts.
  const pending = !existing ? schema
    : existing.name === "auth_codes" ? [...refreshReadSchema,...inventorySyncSchema,...salesFailureSchema]
    : existing.name === "refresh_owner_started" ? [...inventorySyncSchema,...salesFailureSchema]
    : salesFailureSchema;
  await db.batch(pending.map(sql=>db.prepare(sql.replace(/^CREATE (TABLE|(?:UNIQUE )?INDEX) (?!IF NOT EXISTS )/i,"CREATE $1 IF NOT EXISTS "))));
 }
 schemaReady=true;
}
function redirect(url:string,cookie?:string){const headers=new Headers({Location:url,"Cache-Control":"no-store","Referrer-Policy":"no-referrer"});if(cookie)headers.set("Set-Cookie",cookie);return new Response(null,{status:303,headers});}
function error(message:string,status=400){return Response.json({error:message},{status,headers:{"Cache-Control":"no-store"}});}
function config(){
 const frontend=env.FRONTEND_URL??"",owner=env.OWNER_GITHUB_ID??"",secret=env.SESSION_SECRET??"";
 if(env.FREE_ONLY!=="true")throw new Error("Free-only deployment guard is disabled. The backend is stopped.");
 if(!/^\d+$/.test(owner)||!frontend.startsWith("https://")||secret.length<32)throw new Error("Private sign-in has not been configured.");
 return {frontend,owner,secret};
}
async function route(request:Request){
 const url=new URL(request.url);
 if(url.pathname==="/health")return Response.json({service:"tcg-data-api",freeOnly:env.FREE_ONLY==="true",databaseConfigured:!!env.DB,apiConfigured:!!env.API_SH_API_KEY,signInConfigured:!!(env.GITHUB_CLIENT_ID&&env.GITHUB_CLIENT_SECRET&&env.SESSION_SECRET)}, {headers:{"Cache-Control":"no-store"}});
 const {frontend,owner,secret}=config();
 if(!allowedOrigin(request.headers.get("Origin"),frontend))return error("This website is not allowed to access the private backend.",403);
 if(request.method==="OPTIONS")return new Response(null,{status:204});
 if(url.pathname==="/auth/login"&&request.method==="GET"){
  if(!env.GITHUB_CLIENT_ID||!env.GITHUB_CLIENT_SECRET)return error("GitHub sign-in setup is not complete.",503);
  const frontendChallenge=url.searchParams.get("challenge")??"";
  if(!/^[A-Za-z0-9_-]{43}$/.test(frontendChallenge))return error("Start sign-in from the app.");
  const state=randomCode(),verifier=randomCode(),signed=await sign({kind:"oauth",exp:Date.now()+600000,state,verifier,challenge:frontendChallenge},secret);
  const github=new URL("https://github.com/login/oauth/authorize");
  github.search=new URLSearchParams({client_id:env.GITHUB_CLIENT_ID,redirect_uri:url.origin+"/auth/callback",state,code_challenge:await challengeFor(verifier),code_challenge_method:"S256"}).toString();
  return redirect(github.href,oauthCookie(signed));
 }
 if(url.pathname==="/auth/callback"&&request.method==="GET"){
  const temporary=await verify(readOauthCookie(request),secret,"oauth"),code=url.searchParams.get("code");
  const fail=(message:string)=>redirect(frontend+"#error="+encodeURIComponent(message),oauthCookie("",0));
  if(!temporary?.verifier||!temporary.challenge||temporary.state!==url.searchParams.get("state")||!code)return fail("Sign-in could not be verified. Please try again.");
  const exchanged=await fetch("https://github.com/login/oauth/access_token",{method:"POST",headers:{Accept:"application/json","Content-Type":"application/json"},body:JSON.stringify({client_id:env.GITHUB_CLIENT_ID,client_secret:env.GITHUB_CLIENT_SECRET,code,redirect_uri:url.origin+"/auth/callback",code_verifier:temporary.verifier}),signal:AbortSignal.timeout(25000)});
  const token=await exchanged.json() as {access_token?:string};
  if(!exchanged.ok||!token.access_token)return fail("GitHub could not complete sign-in.");
  const profile=await fetch("https://api.github.com/user",{headers:{Authorization:"Bearer "+token.access_token,Accept:"application/vnd.github+json","User-Agent":"TCG-Data"},signal:AbortSignal.timeout(25000)});
  const identity=await profile.json() as {id?:number};
  if(!profile.ok||String(identity.id)!==owner)return fail("This inventory is only available to its owner.");
  await ensureSchema();
  const loginCode=randomCode();
  await env.DB!.batch([env.DB!.prepare("DELETE FROM auth_codes WHERE expires_at<?").bind(Date.now()),env.DB!.prepare("INSERT INTO auth_codes (id,owner,challenge,expires_at) VALUES (?,?,?,?)").bind(await challengeFor(loginCode),owner,temporary.challenge,Date.now()+60000)]);
  return redirect(frontend+"#code="+loginCode,oauthCookie("",0));
 }
 if(url.pathname==="/auth/exchange"&&request.method==="POST"){
  if(request.headers.get("Origin")!==new URL(frontend).origin)return error("Invalid sign-in origin.",403);
  if(Number(request.headers.get("Content-Length")??0)>2048)return error("Invalid sign-in request.");
  const body=await request.json() as {code?:string;verifier?:string};
  if(!/^[A-Za-z0-9_-]{43}$/.test(body.code??"")||!/^[A-Za-z0-9_-]{43}$/.test(body.verifier??""))return error("Invalid sign-in request.");
  const login=await env.DB!.prepare("DELETE FROM auth_codes WHERE id=? AND challenge=? AND expires_at>? RETURNING owner").bind(await challengeFor(body.code!),await challengeFor(body.verifier!),Date.now()).first<{owner:string}>();
  if(!login||login.owner!==owner)return error("Sign-in expired or was already used. Please try again.",401);
  return Response.json({token:await sign({kind:"session",owner,exp:Date.now()+8*3600000},secret)},{headers:{"Cache-Control":"no-store"}});
 }
 if(!url.pathname.startsWith("/api/"))return error("Not found.",404);
 if(!["GET","POST"].includes(request.method))return error("Method not allowed.",405);
 const authenticated=await authenticatedOwner(request,secret,owner);
 if(!authenticated)return error("Sign in to access your private inventory.",401);
 await ensureSchema();
 return handleApi(request,authenticated,url.pathname.slice(5),new URL(frontend).origin);
}
export default {
 async fetch(request:Request){
  let response:Response;
  try{response=await route(request);}catch(e){const quota=/quota|limit.*exceeded|exceeded.*limit/i.test(e instanceof Error?e.message:"");response=error(quota?"Cloudflare free-plan capacity was reached. Try again after the daily UTC reset. No paid upgrade was enabled.":e instanceof Error?e.message:"The private backend is unavailable.",503);}
  const headers=new Headers(response.headers),origin=request.headers.get("Origin");
  if(origin&&allowedOrigin(origin,env.FRONTEND_URL??"")){
   headers.set("Access-Control-Allow-Origin",origin);headers.set("Access-Control-Allow-Methods","GET,POST,OPTIONS");headers.set("Access-Control-Allow-Headers","Authorization,Content-Type");headers.set("Access-Control-Expose-Headers","Content-Disposition");headers.set("Vary","Origin");
  }
  headers.set("X-Content-Type-Options","nosniff");headers.set("Referrer-Policy","no-referrer");headers.set("Cache-Control","no-store");
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
 }
};
