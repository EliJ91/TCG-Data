import { apiKey, AppError, database, workspace } from "./data";
import { API_SH_BASE, accountSnapshot, chargedCredits } from "./api-sh";
type Json = Record<string, any>;
export async function freeGet(key: string, path: string) {
  const response = await fetch(API_SH_BASE+path,{headers:{"x-api-key":key,Accept:"application/json"},signal:AbortSignal.timeout(125000)});
  if(!response.ok) throw new AppError("API.SH account information is unavailable (HTTP "+response.status+"). No market requests were made.",response.status===401?409:503);
  return response.json() as Promise<Json>;
}
export async function syncAccount(owner: string) {
  const key=await apiKey(await workspace(owner));
  const initial=accountSnapshot(await freeGet(key,"/v1/account"));
  if(!initial.accountId) throw new AppError("API.SH did not identify the account. Refreshing is blocked.",503);
  const db=database(),id=initial.accountId,token=crypto.randomUUID();
  await db.prepare("INSERT OR IGNORE INTO credit_accounts (id) VALUES (?)").bind(id).run();
  const locked=await db.prepare("UPDATE credit_accounts SET lock_token=?,lock_until=? WHERE id=? AND reserved=0 AND lock_until<?").bind(token,Date.now()+270000,id,Date.now()).run();
  if(locked.meta.changes) {
    try {
      // Re-read after acquiring the lock so an older response cannot restore spent credits.
      const snapshot=accountSnapshot(await freeGet(key,"/v1/account"));
      if(snapshot.accountId!==id) throw new AppError("The API.SH account changed. Refreshing is blocked.",503);
      await db.prepare("UPDATE credit_accounts SET available=CASE WHEN period=? AND dirty=0 THEN MIN(available,?) ELSE ? END,snapshot=?,period=?,dirty=?,lock_token=NULL,lock_until=0 WHERE id=? AND lock_token=? AND reserved=0").bind(String(snapshot.resetAt??""),snapshot.freeRemaining??0,snapshot.freeRemaining??0,JSON.stringify(snapshot),String(snapshot.resetAt??""),snapshot.verified?0:1,id,token).run();
    } catch(error) {
      await db.prepare("UPDATE credit_accounts SET dirty=1,lock_token=NULL,lock_until=0 WHERE id=? AND lock_token=?").bind(id,token).run();
      throw error;
    }
  }
  const row=await db.prepare("SELECT * FROM credit_accounts WHERE id=?").bind(id).first<Json>();
  const saved=JSON.parse(row!.snapshot);
  const since=await db.prepare("SELECT COALESCE(SUM(CASE WHEN status='reserved' THEN reserved ELSE COALESCE(charged,reserved) END),0) AS used FROM api_requests WHERE account_id=? AND created_at>=?").bind(id,saved.updatedAt??0).first<Json>();
  const snapshot={...saved,available:row!.dirty || row!.lock_until>Date.now()?0:Math.max(0,Math.min(row!.available,(saved.available??0)-Number(since?.used??0))),reserved:row!.reserved,blocked:!!row!.dirty};
  await db.prepare("UPDATE workspaces SET usage=? WHERE owner=?").bind(JSON.stringify(snapshot),owner).run();
  return snapshot;
}
export async function accountDetails(owner: string) {
  const snapshot=await syncAccount(owner),key=await apiKey(await workspace(owner));
  const results=await Promise.allSettled([freeGet(key,"/v1/account/usage"),freeGet(key,"/v1/account/logs")]);
  const report={snapshot,usage:results[0].status==="fulfilled"?results[0].value:null,logs:results[1].status==="fulfilled"?results[1].value:null,errors:results.flatMap(r=>r.status==="rejected"?[String(r.reason?.message??r.reason)]:[])};
  const requests=await database().prepare("SELECT id,path,created_at,reserved,charged,status,request_id,metadata FROM api_requests WHERE owner=? ORDER BY created_at DESC LIMIT 50").bind(owner).all();
  return {...report,requests:requests.results};
}
export async function reserveCredits(owner:string,runId:string,path:string,cost:number) {
  const snapshot=await syncAccount(owner);
  if(!snapshot.verified || snapshot.blocked || !snapshot.accountId) throw new AppError("Free credit balance could not be verified. Refreshing is blocked.",403);
  const db=database(),id=crypto.randomUUID(),now=Date.now();
  // D1 batches are transactions. The conditional UPDATE is the single atomic budget gate.
  const result=await db.batch([
    db.prepare("UPDATE credit_accounts SET available=available-?,reserved=reserved+? WHERE id=? AND available>=? AND dirty=0 AND lock_until<? AND CAST(period AS INTEGER)>? AND COALESCE((SELECT SUM(CASE WHEN status='reserved' THEN reserved ELSE COALESCE(charged,reserved) END) FROM api_requests WHERE account_id=credit_accounts.id AND created_at>=json_extract(credit_accounts.snapshot,'$.updatedAt')),0)+?<=json_extract(snapshot,'$.available') AND EXISTS (SELECT 1 FROM refresh_runs WHERE id=? AND owner=? AND status='running' AND COALESCE((SELECT SUM(CASE WHEN status='reserved' THEN reserved ELSE COALESCE(charged,reserved) END) FROM api_requests WHERE run_id=?),0)+?<=json_extract(detail,'$.maximumCredits'))").bind(cost,cost,snapshot.accountId,cost,now,now,cost,runId,owner,runId,cost),
    db.prepare("INSERT INTO api_requests (id,owner,account_id,run_id,path,created_at,reserved,status) SELECT ?,?,?,?,?,?,?,'reserved' WHERE changes()=1").bind(id,owner,snapshot.accountId,runId,path,now,cost),
  ]);
  if(!result[0].meta.changes || !result[1].meta.changes) throw new AppError("Not enough verified free credits. Refreshing stopped; saved data is preserved.",403);
  return {id,accountId:snapshot.accountId,cost};
}
export async function settleCredits(reservation:{id:string;accountId:string;cost:number},response:Response|null,body:Json,owner:string) {
  const charge=response?chargedCredits(response.headers,body,reservation.cost):{used:reservation.cost,verified:false,requestId:null,combinedRemaining:null};
  const db=database();
  // An interrupted request remains reserved. Never expire it into spendable credits.
  await db.batch([
    db.prepare("UPDATE credit_accounts SET available=MAX(0,available+?-?),reserved=MAX(0,reserved-?),dirty=CASE WHEN ?=1 THEN dirty ELSE 1 END WHERE id=? AND EXISTS (SELECT 1 FROM api_requests WHERE id=? AND status='reserved')").bind(reservation.cost,charge.used,reservation.cost,charge.verified?1:0,reservation.accountId,reservation.id),
    db.prepare("UPDATE api_requests SET charged=?,status=?,request_id=?,metadata=? WHERE id=? AND owner=? AND status='reserved'").bind(charge.used,response?.ok?"ok":response?"error":"uncertain",charge.requestId,JSON.stringify({chargeVerified:charge.verified,httpStatus:response?.status??null,combinedRemaining:charge.combinedRemaining}),reservation.id,owner),
  ]);
  return charge;
}
