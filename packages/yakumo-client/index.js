// Bridges the Koishi console client build into the yakumo pipeline.
//
// `@koishijs/client/lib` registers a `client` *service* via `ctx.register`, which yakumo 1.x
// could reach from `pipeline.build` but yakumo 3.x cannot: `ctx.cli.execute` only dispatches
// CLI commands. This plugin exposes the same build as a CLI command so the step actually runs.
import { build } from "@koishijs/client/lib";

export const inject = ["yakumo", "cli"];

function apply(ctx) {
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
