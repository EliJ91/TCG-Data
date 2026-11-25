type Signed={kind:string;exp:number;owner?:string;state?:string;verifier?:string;challenge?:string};
const encoder=new TextEncoder();
export const encode=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"");
export const randomCode=()=>encode(crypto.getRandomValues(new Uint8Array(32)));
export const challengeFor=async(value:string)=>encode(new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(value))));
const decode=(value:string)=>Uint8Array.from(atob(value.replaceAll("-","+").replaceAll("_","/")),c=>c.charCodeAt(0));
const keyFor=(secret:string)=>crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign","verify"]);
export async function sign(data:Signed,secret:string){
 if(secret.length<32)throw new Error("Session signing secret is not configured.");
 const payload=encode(encoder.encode(JSON.stringify(data))),signature=await crypto.subtle.sign("HMAC",await keyFor(secret),encoder.encode(payload));
 return payload+"."+encode(new Uint8Array(signature));
}
export async function verify(value:string,secret:string,kind:string,now=Date.now()):Promise<Signed|null>{
 if(!value||value.length>2048||secret.length<32)return null;
 const [payload,signature,extra]=value.split(".");if(!payload||!signature||extra!==undefined)return null;
 try{
  if(!await crypto.subtle.verify("HMAC",await keyFor(secret),decode(signature),encoder.encode(payload)))return null;
  const data=JSON.parse(new TextDecoder().decode(decode(payload))) as Signed;
  return data.kind===kind&&Number.isFinite(data.exp)&&data.exp>now?data:null;
 }catch{return null;}
}
export function allowedOrigin(origin:string|null,frontend:string){
 if(!origin)return true;
 try{return origin===new URL(frontend).origin;}catch{return false;}
}
export async function authenticatedOwner(request:Request,secret:string,owner:string){
 const header=request.headers.get("Authorization")??"";
 const data=header.startsWith("Bearer ")?await verify(header.slice(7),secret,"session"):null;
 return data?.owner===owner?owner:null;
}
export function oauthCookie(value:string,seconds=600){return "__Host-tcg_oauth="+value+"; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age="+seconds;}
export function readOauthCookie(request:Request){return request.headers.get("Cookie")?.split(";").map(s=>s.trim()).find(s=>s.startsWith("__Host-tcg_oauth="))?.slice("__Host-tcg_oauth=".length)??"";}
