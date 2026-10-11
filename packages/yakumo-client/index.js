// Run the core model bundle and config UI steps after yakumo-esbuild.
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

export const inject = ["yakumo", "cli"];

function apply(ctx) {
    ctx.cli.command("client [...packages]", "Build Koishi console client bundles").action(async ({ args }) => {
        await ctx.yakumo.initialize();
        const packages = ctx.yakumo.locate(args);
        if (!packages.length) throw new Error("No package matched the given arguments");
        for (const path of packages) {
            const meta = ctx.yakumo.workspaces[path];
            if (meta.name !== "koishi-plugin-yesimbot") continue;
            const cwd = join(ctx.yakumo.cwd, path);
            // xsai is ESM-only and intentionally bundled into the CJS plugin.
            // The config UI uses the existing esbuild entry, not a Vite client.
            for (const script of ["scripts/bundle.mjs", "scripts/build-client.mjs"]) {
                await execute(process.execPath, [script], { cwd });
            }
        }
    });
}

export { apply };
