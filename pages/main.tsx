import {useEffect,useState} from "react";
import {createRoot} from "react-dom/client";
import Inventory from "../app/Inventory";
import "../app/globals.css";
import {inventoryCacheScope,sessionKey} from "../lib/client-api";
import {clearInventoryCache} from "../lib/inventory-cache";
const configured=String(import.meta.env.VITE_API_URL??"").replace(/\/$/,"");
const backend=configured&&new URL(configured).protocol==="https:"?configured:import.meta.env.DEV?configured:"";
window.__TCG_BACKEND__=backend;
window.__TCG_HOME__=import.meta.env.BASE_URL;
const encode=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"");
function App(){
 const [signedIn,setSignedIn]=useState(!!sessionStorage.getItem(sessionKey)),[busy,setBusy]=useState(false),[error,setError]=useState("");
 useEffect(()=>{
  document.documentElement.dataset.theme=localStorage.getItem("sortswift-theme")??"dark";
  const expired=()=>{setSignedIn(false);setError("Your session expired. Sign in again to continue.");};
  window.addEventListener("tcg-session-expired",expired);
  const params=new URLSearchParams(location.hash.slice(1)),code=params.get("code"),message=params.get("error");
  if(code||message)history.replaceState(null,"",location.pathname+location.search);
  if(message)setError(message);
  if(code&&backend){
    const verifier=sessionStorage.getItem("tcg-login-verifier");sessionStorage.removeItem("tcg-login-verifier");
    if(!verifier)setError("Sign-in could not be verified. Please try again.");
    else{setBusy(true);void fetch(backend+"/auth/exchange",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code,verifier}),credentials:"omit",redirect:"error"}).then(async response=>{const data=await response.json() as {token?:string;error?:string};if(!response.ok||!data.token)throw new Error(data.error??"Sign-in failed.");sessionStorage.setItem(sessionKey,data.token);setSignedIn(true);}).catch(e=>setError(e.message)).finally(()=>setBusy(false));}
  }
  return()=>window.removeEventListener("tcg-session-expired",expired);
 },[]);
 const login=async()=>{try{setBusy(true);const verifier=encode(crypto.getRandomValues(new Uint8Array(32)));const challenge=encode(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(verifier))));sessionStorage.setItem("tcg-login-verifier",verifier);location.assign(backend+"/auth/login?challenge="+encodeURIComponent(challenge));}catch(e){setBusy(false);setError(e instanceof Error?e.message:"Sign-in failed.");}};
 if(signedIn&&backend)return <Inventory onSignOut={()=>{const scope=inventoryCacheScope();sessionStorage.removeItem(sessionKey);setSignedIn(false);if(scope)void clearInventoryCache(scope).catch(()=>{});}}/>;
 return <main className="signin"><div className="signin-card"><div className="wordmark">SortSwift <span>Market</span></div><h1>Your inventory. A clearer next move.</h1><p>Sign in with GitHub to open your private inventory. Your API key stays on the server.</p>{error&&<p role="alert" className="danger-text">{error}</p>}{!backend?<p className="muted">The private backend connection is being configured.</p>:<button className="button primary" disabled={busy} onClick={()=>void login()}>{busy?"Connecting…":"Sign in with GitHub"}</button>}<p className="small muted">Access is limited to the site owner. Signing in requests no repository access.</p></div></main>;
}
createRoot(document.getElementById("root")!).render(<App/>);
