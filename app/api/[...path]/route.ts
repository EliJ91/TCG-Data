import { getChatGPTUser } from "../../chatgpt-auth";
import { handleApi } from "../../../lib/http-api";
export const dynamic = "force-dynamic";
type Context={params:Promise<{path:string[]}>};
async function handle(request:Request,context:Context){
 const user=await getChatGPTUser();
 return handleApi(request,user?.userId??"",(await context.params).path.join("/"));
}
export const GET=handle;
export const POST=handle;
