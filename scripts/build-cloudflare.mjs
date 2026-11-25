import {build} from "esbuild";
import {mkdir,readFile,readdir,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
const statements=[];
for(const name of (await readdir("drizzle")).filter(n=>n.endsWith(".sql")).sort()){
 const sql=await readFile(resolve("drizzle",name),"utf8");
 statements.push(...sql.replaceAll("--> statement-breakpoint","").split(";").map(s=>s.trim()).filter(Boolean));
}
await mkdir("cloudflare/generated",{recursive:true});
await writeFile("cloudflare/generated/schema.ts","export const schema="+JSON.stringify(statements)+";\n");
await build({entryPoints:["cloudflare/worker.ts"],outdir:"dist/backend",bundle:true,format:"esm",platform:"neutral",target:"es2022",external:["cloudflare:workers","node:async_hooks"],minify:true,sourcemap:false});
console.log("Built standalone Cloudflare backend without client assets or secrets.");
