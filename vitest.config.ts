import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// `koishi`'s ESM entry (lib/index.mjs) throws on load here: @koishijs/loader default-imports
// its own CJS `shared.js`, gets the exports namespace instead of the class, and then reads
// `Loader.extensions`. Tests only need `Schema`/`Context`, which @koishijs/core exports
// directly, so alias the bare specifier to that package.
const koishiCore = fileURLToPath(new URL("./node_modules/@koishijs/core", import.meta.url));

export default defineConfig({
    resolve: {
        alias: {
            koishi: koishiCore,
            // Other packages import the workspace core without a build step;
            // resolve the package (and its subpaths) to the TypeScript sources.
            "koishi-plugin-yesimbot": fileURLToPath(new URL("./packages/core/src", import.meta.url)),
        },
    },
    test: {
        exclude: ["**/node_modules/**", "**/.git/**"],
        include: ["packages/*/tests/**/*.spec.ts"],
        // onebot-directory pulls a 2005-member list into the database per test;
        // on Windows a cold run can exceed the 5s default under parallel load.
        testTimeout: 30_000,
        hookTimeout: 30_000,
        teardownTimeout: 30_000,
        server: {
            deps: {
                // plugin-mock imports "koishi" natively; without inlining it binds a
                // second Context class and events never reach the aliased koishi.
                inline: [/@koishijs\/plugin-mock/],
            },
        },
    },
});
