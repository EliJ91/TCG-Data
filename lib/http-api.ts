import { limitOperation, syncMetadata, syncInventory, syncChanges } from "./inventory-sync";
import {
  AppError,
  database,
  workspace,
  state,
  queryCards,
  facets,
  startImport,
  uploadChunk,
  editInventory,
  commitImport,
  cancelImport,
  savePreferences,
  exportInventory,
} from "./data";
import {
  prepareRefreshPlan,
  startRefresh,
  refreshStep,
  cancelRefresh,
  failedProducts,
  recoverResult,
  linkProduct,
} from "./market";
import { syncAccount, accountDetails } from "./credits";
export async function handleApi(request:Request,owner:string,path:string,allowedOrigin?:string){
  try {
    if (!owner) throw new AppError("Sign in to access your inventory.",401);
    const url = new URL(request.url);
    if (request.method === "POST") {
      const origin = request.headers.get("origin");
      if (origin && origin !== (allowedOrigin ?? url.origin))
        throw new AppError("This request came from another website.", 403);
      const body = (await request.json()) as any;
      if (path === "preferences")
        return Response.json(await savePreferences(owner, body));
      if (path === "imports/start") {
        await limitOperation(owner,"import-start",15,86_400_000);
        return Response.json(await startImport(owner, body));
      }
      if (path === "imports/chunk")
        return Response.json(
          await uploadChunk(owner, body.id, body.start, body.rows),
        );
      if (path === "imports/commit")
        return Response.json(await commitImport(owner, body.id, body.sync === true, body.productIdColumn));
      if (path === "imports/cancel")
        return Response.json(await cancelImport(owner, body.id));
      if (path === "inventory/edit")
        return Response.json(await editInventory(owner, body));
      if (path === "market/recover") return Response.json(await recoverResult(owner,body.id));
      if (path === "market/product") return Response.json(await linkProduct(owner,body.key,String(body.productId??"")));
      if (path === "market/plan")
        return Response.json(await prepareRefreshPlan(owner, body));
      if (path === "market/start")
        return Response.json(await startRefresh(owner, body));
      if (path === "market/step") {
        await limitOperation(owner,"sales-products",2000,86_400_000);
        return Response.json(await refreshStep(owner, body.id, body.key));
      }
      if (path === "market/cancel")
        return Response.json(await cancelRefresh(owner, body.id));
      if (path === "export") return exportInventory(owner, body);
    } else {
      if (path === "sync/meta") return Response.json(await syncMetadata(owner,url.searchParams.get("version")));
      if (path === "sync/inventory") return Response.json(await syncInventory(owner,url.searchParams));
      if (path === "sync/changes") return Response.json(await syncChanges(owner,url.searchParams));
      if (path === "market/failures") return Response.json(await failedProducts(owner,url.searchParams.get("before")));
      if (path === "account") return Response.json(await syncAccount(owner),{headers:{"Cache-Control":"no-store"}});
      if (path === "account/details") {
        await limitOperation(owner,"account-details",6,60_000);
        return Response.json(await accountDetails(owner),{headers:{"Cache-Control":"no-store"}});
      }
      if (path === "state")
        return Response.json(await state(owner), {
          headers: { "Cache-Control": "no-store" },
        });
      if (path === "facets") {
        const keys = url.searchParams.getAll("column");
        const dateFrom = url.searchParams.get("dateFrom") ?? "";
        const dateTo = url.searchParams.get("dateTo") ?? "";
        return Response.json(await facets(owner,keys.length ? {keys,dateFrom,dateTo} : undefined));
      }
      if (path === "cards")
        return Response.json(
          await queryCards(
            owner,
            JSON.parse(url.searchParams.get("q") ?? "{}"),
          ),
          { headers: { "Cache-Control": "no-store" } },
        );
      if (path === "card") {
        const space = await workspace(owner),
          key = url.searchParams.get("key") ?? "";
        const card = await database()
          .prepare(
            "SELECT info,quantity FROM cards WHERE owner=? AND version=? AND card_key=?",
          )
          .bind(owner, space.active_version ?? "", key)
          .first<{ info: string; quantity: number }>();
        if (!card) throw new AppError("Card not found.", 404);
        const market = await database()
          .prepare(
            "SELECT data,detail,fetched_at FROM market WHERE owner=? AND card_key=?",
          )
          .bind(owner, key)
          .first<{ data: string; detail: string; fetched_at: number }>();
        const raw = await database()
          .prepare(
            "SELECT raw FROM inventory_rows WHERE owner=? AND version=? AND card_key=? ORDER BY row_no LIMIT 20",
          )
          .bind(owner, space.active_version ?? "", key)
          .all<{ raw: string }>();
        const savedMarket=market?JSON.parse(market.data):null, savedDetail=market?JSON.parse(market.detail):null;
        const salesMarket=savedMarket?Object.fromEntries(["scope","analyzed","available","granularity","historyRange","unitsSold","historyFrom","historyTo"].map(field=>[field,savedMarket[field]??null])):null;
        const salesDetail=savedDetail?{product:{productId:savedDetail.product?.productId},history:(savedDetail.history??[]).map((point:any)=>({date:point.date,units:point.units})),granularity:savedDetail.granularity,range:savedDetail.range,notes:["Dates select reported "+(savedDetail.granularity==="daily"?"daily":"weekly")+" quantity totals."]}:null;
        const {originalPrice: _originalPrice,...cardInfo}=JSON.parse(card.info);
        return Response.json({
          card: { ...cardInfo, quantity: card.quantity },
          market: salesMarket,
          detail: salesDetail,
          fetchedAt: market?.fetched_at,
          originals: raw.results.map((row) => JSON.parse(row.raw)),
        });
      }
    }
    throw new AppError("Not found.", 404);
  } catch (error) {
    const quota = /quota|daily.*limit|storage.*limit|D1_ERROR.*limit/i.test(error instanceof Error ? error.message : "");
    const status = quota ? 503 : error instanceof AppError ? error.status : 500;
    return Response.json(
      {
        error:
          quota ? "Cloudflare free-plan capacity was reached. Your saved inventory is preserved. Try again after the daily UTC reset; no paid upgrade was enabled." : error instanceof Error
            ? error.message
            : "The request could not be completed.",
      },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
