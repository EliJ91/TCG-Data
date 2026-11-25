import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";
import {resolve} from "node:path";
export default defineConfig({
 root:resolve("pages"),base:"/TCG-Data/",publicDir:resolve("public"),
 envDir:resolve("."),plugins:[react()],
 build:{outDir:resolve("dist/pages"),emptyOutDir:true,sourcemap:false},
 server:{host:"127.0.0.1",port:5188,fs:{allow:[resolve(".")]}},
});
