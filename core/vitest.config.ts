import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "koishi-plugin-yesimbot-workspace": "../plugins/workspace/src/index.ts",
    },
  },
  test: {
    root: ".",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
  },
});
