import {build} from "esbuild";
import {mkdir,readFile,readdir,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
const statements=[], refreshReadSchema=[], inventorySyncSchema=[], salesFailureSchema=[];
for(const name of (await readdir("drizzle")).filter(n=>n.endsWith(".sql")).sort()){
 const sql=await readFile(resolve("drizzle",name),"utf8");
 const migration=sql.split("--> statement-breakpoint").map(s=>s.trim().replace(/;$/, "")).filter(Boolean);
 statements.push(...migration);
 if(name==="0004_bound_refresh_reads.sql")refreshReadSchema.push(...migration);
 if(name==="0005_inventory_sync.sql")inventorySyncSchema.push(...migration);
 if(name==="0006_sales_failures.sql")salesFailureSchema.push(...migration);
}
await mkdir("cloudflare/generated",{recursive:true});
await writeFile("cloudflare/generated/schema.ts","export const schema="+JSON.stringify(statements)+";\nexport const refreshReadSchema="+JSON.stringify(refreshReadSchema)+";\nexport const inventorySyncSchema="+JSON.stringify(inventorySyncSchema)+";\nexport const salesFailureSchema="+JSON.stringify(salesFailureSchema)+";\n");
await build({entryPoints:["cloudflare/worker.ts"],outdir:"dist/backend",bundle:true,format:"esm",platform:"neutral",target:"es2022",external:["cloudflare:workers","node:async_hooks"],minify:true,sourcemap:false});
console.log("Built standalone Cloudflare backend without client assets or secrets.");
