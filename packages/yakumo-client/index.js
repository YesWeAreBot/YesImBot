import path from "node:path";

// Bridges the Koishi console client build into the yakumo pipeline.
//
// `@koishijs/client/lib` registers a `client` *service* via `ctx.register`, which yakumo 1.x
// could reach from `pipeline.build` but yakumo 3.x cannot: `ctx.cli.execute` only dispatches
// CLI commands. This plugin exposes the same build as a CLI command so the step actually runs.
import { build } from "@koishijs/client/lib";

export const inject = ["yakumo", "cli"];

function apply(ctx) {
    ctx.on("yakumo/esbuild", async (workspace, options, next) => {
        if (options.format !== "cjs") return next();
        const meta = ctx.yakumo.workspaces[workspace];
        const targets = [];
        const collect = (value) => {
            if (typeof value === "string") targets.push(value);
            else if (value && typeof value === "object") Object.values(value).forEach(collect);
        };
        collect(meta.exports);
        const runtimeExports = new Map();
        for (const target of targets) {
            const output = path.resolve(ctx.yakumo.cwd + workspace, target);
            if (!/\.(?:c|m)?js$/.test(output) || !output.startsWith(options.outdir + path.sep)) continue;
            const relative = path.relative(options.outdir, output).replace(/\.(?:c|m)?js$/, ".ts");
            runtimeExports.set(path.resolve(options.outbase, relative), output);
        }
        const [entryName, entrySource] = Object.entries(options.entryPoints)[0];
        const entryOutput = path.resolve(options.outdir, entryName + options.outExtension[".js"]);
        options.plugins.unshift({
            name: "workspace-runtime-exports",
            setup(builder) {
                builder.onResolve({ filter: /^\./, namespace: "file" }, async (args) => {
                    const resolved = await builder.resolve(args.path, {
                        namespace: "runtime-export",
                        importer: args.importer,
                        resolveDir: args.resolveDir,
                        kind: args.kind,
                    });
                    const target = runtimeExports.get(resolved.path);
                    if (!target || resolved.path === entrySource) return;
                    let relative = path.relative(path.dirname(entryOutput), target).replace(/\\/g, "/");
                    if (!relative.startsWith(".")) relative = "./" + relative;
                    return { path: relative, external: true };
                });
            },
        });
        return next();
    });
    ctx.cli.command("client [...packages]", "Build Koishi console client bundles").action(async ({ args }) => {
        await ctx.yakumo.initialize();
        const packages = ctx.yakumo.locate(args);
        if (!packages.length) throw new Error("No package matched the given arguments");
        for (const path of packages) {
            const meta = ctx.yakumo.workspaces[path];
            if (!meta.dependencies?.["@koishijs/client"] && !meta.devDependencies?.["@koishijs/client"]) continue;
            await build(ctx.yakumo.cwd + path, meta.yakumo?.client);
        }
    });
}

export { apply };
