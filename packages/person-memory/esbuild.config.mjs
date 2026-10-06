import { build } from "esbuild";
await build({ entryPoints: ["src/*.ts"], outdir: "lib", bundle: false, platform: "node", format: "cjs", sourcemap: true });
