import { inventoryIdentity, type InventorySnapshot, type SyncCard, type SyncEvent, type SyncMetadata } from "./local-inventory";

type SyncApi = <T>(path: string) => Promise<T>;

function openCache() {
  return new Promise<IDBDatabase>((resolve,reject)=>{
    const request = indexedDB.open("tcg-data-inventory",1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("metadata");
      request.result.createObjectStore("cards");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const range = (scope: string) => IDBKeyRange.bound([scope],[scope,[]],false,true);

export async function readInventoryCache(scope: string): Promise<InventorySnapshot|null> {
  const db = await openCache();
  try {
    return await new Promise((resolve,reject)=>{
      const tx = db.transaction(["metadata","cards"]);
      const meta = tx.objectStore("metadata").get(scope);
      const cards = tx.objectStore("cards").getAll(range(scope));
      tx.oncomplete = () => resolve(meta.result ? {meta:meta.result,cards:cards.result} : null);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

export async function clearInventoryCache(scope: string) {
  const db = await openCache();
  try {
    await new Promise<void>((resolve,reject)=>{
      const tx = db.transaction(["metadata","cards"],"readwrite");
      tx.objectStore("metadata").delete(scope);
      tx.objectStore("cards").delete(range(scope));
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

async function writeInventoryCache(scope: string, snapshot: InventorySnapshot, previous: InventorySnapshot|null) {
  const db = await openCache();
  try {
    await new Promise<void>((resolve,reject)=>{
      const tx = db.transaction(["metadata","cards"],"readwrite");
      const metadata = tx.objectStore("metadata");
      const cards = tx.objectStore("cards");
      // Another tab can finish a newer sync while this request is in flight.
      const current = metadata.get(scope);
      current.onsuccess = () => {
        const stored = current.result as SyncMetadata|undefined;
        if (stored && (stored.version !== previous?.meta.version || stored.sequence !== previous.meta.sequence)) {
          if ((stored.updatedAt??0)>(snapshot.meta.updatedAt??0) || stored.sequence>snapshot.meta.sequence) return;
          cards.delete(range(scope));
          for (const card of snapshot.cards) cards.put(card,[scope,card.key]);
        } else {
          const before = new Map(previous?.cards.map(card=>[card.key,card]));
          for (const card of snapshot.cards) {
            if (before.get(card.key)!==card) cards.put(card,[scope,card.key]);
            before.delete(card.key);
          }
          for (const key of before.keys()) cards.delete([scope,key]);
        }
        metadata.put(snapshot.meta,scope);
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

async function pages<T>(api: SyncApi, route: string, after: number) {
  const rows: T[] = [];
  let next: number|null = after;
  while (next !== null) {
    const result: {rows:T[];next:number|null} = await api(route+"&after="+next);
    rows.push(...result.rows);
    next = result.next;
  }
  return rows;
}

export async function synchronizeInventory(api: SyncApi, scope: string, previous: InventorySnapshot|null) {
  const meta = await api<SyncMetadata>("sync/meta"+(previous?.meta.version ? "?version="+encodeURIComponent(previous.meta.version) : ""));
  const sameVersion = previous?.meta.version === meta.version;
  const canPatch = !!previous && !!meta.previousVersion && meta.previousVersion===previous.meta.version;
  let cards = previous?.cards ?? [];
  if (!sameVersion) {
    const route = "sync/inventory?version="+encodeURIComponent(meta.version)+(canPatch ? "&uploaded="+meta.uploaded : "");
    const incoming = meta.version ? await pages<SyncCard>(api,route,-1) : [];
    const current = new Map<string,SyncCard>();
    for (const card of incoming) {
      const existing = current.get(card.key);
      if (!existing) current.set(card.key,card);
      else (existing.originals ??= []).push({rowNo:card.rowNo,raw:card.raw});
    }
    if (canPatch) {
      const identities = new Set(incoming.map(inventoryIdentity));
      for (const card of cards.slice().sort((a,b)=>a.rowNo-b.rowNo)) {
        const identity = inventoryIdentity(card);
        if (identities.has(identity)) continue;
        identities.add(identity);
        current.set(card.key,{...card,rowNo:card.rowNo+meta.uploaded,originals:undefined});
      }
    }
    cards = [...current.values()];
  }
  if ((sameVersion || canPatch) && previous && previous.meta.sequence < meta.sequence) {
    const events = await pages<SyncEvent>(api,"sync/changes?through="+meta.sequence,previous.meta.sequence);
    const market = new Map(events.filter(event=>event.kind==="market").map(event=>[event.subject,event]));
    const skus = new Map(events.filter(event=>event.kind==="sku").map(event=>[event.subject,event.mappedProduct]));
    cards = cards.map(card=>{
      const event = market.get(card.key);
      const sku = skus.size ? String(JSON.parse(card.info).skuId ?? "") : "";
      if (!event && !skus.has(sku)) return card;
      return {...card,
        ...(event && {marketProduct:event.marketProduct,data:event.data,detail:event.detail,fetchedAt:event.fetchedAt}),
        ...(skus.has(sku) && {mappedProduct:skus.get(sku)??null}),
      };
    });
  }
  const snapshot = {meta,cards};
  await writeInventoryCache(scope,snapshot,previous).catch(()=>{});
  return snapshot;
}
