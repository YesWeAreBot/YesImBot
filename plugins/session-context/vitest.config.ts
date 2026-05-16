import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "koishi-plugin-yesimbot": resolve(__dirname, "tests/__shims__/yesimbot.ts"),
    },
  },
  test: {
    root: ".",
    include: ["tests/**/*.test.ts"],
  },
});
