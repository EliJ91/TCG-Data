declare global {
  interface Window { __TCG_BACKEND__?: string; __TCG_HOME__?: string }
}
export const sessionKey="tcg-data-session";
export function appHome(){return typeof window!=="undefined"?window.__TCG_HOME__??"/":"/";}
export async function apiFetch(path:string,init:RequestInit={}){
  const backend=typeof window!=="undefined"?window.__TCG_BACKEND__:undefined;
  if(!backend)return fetch(path,init);
  if(!path.startsWith("/api/"))throw new Error("Invalid API route.");
  const headers=new Headers(init.headers),token=sessionStorage.getItem(sessionKey);
  if(token)headers.set("Authorization","Bearer "+token);
  const response=await fetch(backend+path,{...init,headers,credentials:"omit",cache:"no-store",redirect:"error"});
  if(response.status===401){sessionStorage.removeItem(sessionKey);window.dispatchEvent(new Event("tcg-session-expired"));}
  return response;
}

export function inventoryCacheScope() {
  const backend = window.__TCG_BACKEND__;
  const token = sessionStorage.getItem(sessionKey);
  if (!backend || !token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[0].replaceAll("-","+").replaceAll("_","/")));
    if (payload.kind === "session" && typeof payload.owner === "string" && payload.exp > Date.now())
      return backend+"|"+payload.owner;
  } catch {}
  return null;
}
