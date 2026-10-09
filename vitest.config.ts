import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// bun's isolated linker stores koishi's transitive deps only in per-package store
// siblings; vite cannot reproduce that resolution and the koishi entry's loader
// class chain breaks under interop. Tests only need `Schema`, which is
// @koishijs/core's re-export of schemastery — alias to the same object.
const koishiCore = fileURLToPath(new URL("./node_modules/.bun/@koishijs+core@4.18.11/node_modules/@koishijs/core", import.meta.url));

export default defineConfig({
    resolve: {
        alias: {
            koishi: koishiCore,
            // code-executor tests import the workspace core without a build step;
            // resolve the subpath exports to their TypeScript sources.
            "koishi-plugin-yesimbot/services": fileURLToPath(new URL("./packages/core/src/services/index.ts", import.meta.url)),
            "koishi-plugin-yesimbot/shared": fileURLToPath(new URL("./packages/core/src/shared/index.ts", import.meta.url)),
        },
    },
    test: {
        exclude: ["**/node_modules/**", "**/.git/**"],
        include: ["packages/*/tests/**/*.spec.ts"],
        server: {
            deps: {
                // plugin-mock imports "koishi" natively; without inlining it binds a
                // second Context class and events never reach the aliased koishi.
                inline: [/@koishijs\/plugin-mock/],
            },
        },
    },
});
