import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import ts from "typescript";
const source=ts.transpileModule(readFileSync(new URL("../cloudflare/auth.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const auth=await import("data:text/javascript;base64,"+Buffer.from(source).toString("base64"));
const secret="test-only-signing-secret-".repeat(3);
test("Only valid, unexpired owner session tokens can open the backend",async()=>{
 const token=await auth.sign({kind:"session",owner:"59631669",exp:Date.now()+60000},secret);
 const request=(value)=>new Request("https://backend.workers.dev/api/state",{headers:{Authorization:"Bearer "+value}});
 assert.equal(await auth.authenticatedOwner(request(token),secret,"59631669"),"59631669");
 assert.equal(await auth.authenticatedOwner(request(token),secret,"123"),null);
 assert.equal(await auth.authenticatedOwner(request(token+"x"),secret,"59631669"),null);
 assert.equal(await auth.authenticatedOwner(new Request("https://backend.workers.dev/api/state"),secret,"59631669"),null);
 const expired=await auth.sign({kind:"session",owner:"59631669",exp:Date.now()-1},secret);
 assert.equal(await auth.authenticatedOwner(request(expired),secret,"59631669"),null);
});
test("OAuth state cookies cannot be used as API session tokens",async()=>{
 const token=await auth.sign({kind:"oauth",owner:"59631669",state:"state",exp:Date.now()+60000},secret);
 assert.equal(await auth.verify(token,secret,"session"),null);
});
test("CORS permits the exact GitHub origin and denies lookalike domains",()=>{
 const front="https://elij91.github.io/TCG-Data/";
 assert.equal(auth.allowedOrigin("https://elij91.github.io",front),true);
 for(const origin of ["https://elij91.github.io.evil.test","https://github.io","null","http://elij91.github.io"])assert.equal(auth.allowedOrigin(origin,front),false);
});
test("Sign-in codes use secure randomness and browser-bound PKCE challenges",async()=>{
 const code=auth.randomCode();assert.match(code,/^[A-Za-z0-9_-]{43}$/);
 assert.notEqual(code,auth.randomCode());
 assert.equal(await auth.challengeFor(code),await auth.challengeFor(code));
 assert.notEqual(await auth.challengeFor(code),await auth.challengeFor(auth.randomCode()));
 assert.match(auth.oauthCookie("value"),/Secure; HttpOnly; SameSite=Lax/);
});
