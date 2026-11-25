import { getChatGPTUser } from "../../chatgpt-auth";
import {
  AppError,
  database,
  workspace,
  state,
  queryCards,
  facets,
  startImport,
  uploadChunk,
  commitImport,
  cancelImport,
  savePreferences,
  exportInventory,
} from "../../../lib/data";
import {
  refreshPlan,
  startRefresh,
  refreshStep,
  cancelRefresh,
} from "../../../lib/market";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
async function handle(request: Request, context: Context) {
  try {
    const user = await getChatGPTUser();
    if (!user) throw new AppError("Sign in to access your inventory.", 401);
    const owner = user.userId,
      path = (await context.params).path.join("/"),
      url = new URL(request.url);
    if (request.method === "POST") {
      const origin = request.headers.get("origin");
      if (origin && origin !== url.origin)
        throw new AppError("This request came from another website.", 403);
      const body = (await request.json()) as any;
      if (path === "preferences")
        return Response.json(await savePreferences(owner, body));
      if (path === "imports/start")
        return Response.json(await startImport(owner, body));
      if (path === "imports/chunk")
        return Response.json(
          await uploadChunk(owner, body.id, body.start, body.rows),
        );
      if (path === "imports/commit")
        return Response.json(await commitImport(owner, body.id));
      if (path === "imports/cancel")
        return Response.json(await cancelImport(owner, body.id));
      if (path === "market/plan")
        return Response.json(await refreshPlan(owner, body));
      if (path === "market/start")
        return Response.json(await startRefresh(owner, body));
      if (path === "market/step")
        return Response.json(await refreshStep(owner, body.id, body.key));
      if (path === "market/cancel")
        return Response.json(await cancelRefresh(owner, body.id));
      if (path === "export") return exportInventory(owner, body);
    } else {
      if (path === "state")
        return Response.json(await state(owner), {
          headers: { "Cache-Control": "no-store" },
        });
      if (path === "facets") return Response.json(await facets(owner));
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
        return Response.json({
          card: { ...JSON.parse(card.info), quantity: card.quantity },
          market: market ? JSON.parse(market.data) : null,
          detail: market ? JSON.parse(market.detail) : null,
          fetchedAt: market?.fetched_at,
          originals: raw.results.map((row) => JSON.parse(row.raw)),
        });
      }
    }
    throw new AppError("Not found.", 404);
  } catch (error) {
    const status = error instanceof AppError ? error.status : 500;
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The request could not be completed.",
      },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
export const GET = handle;
export const POST = handle;
