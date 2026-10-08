import { build } from "esbuild";
import { rename } from "node:fs/promises";

await build({
    entryPoints: ["client/index.js"],
    outfile: "dist/index.js",
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2020",
    external: ["vue"],
});
// Koishi's directory entry loader looks for index.js and style.css.
await rename("dist/index.css", "dist/style.css");
