import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@yesimbot/agent/session": "../packages/agent/src/session/index.ts",
      "@yesimbot/agent/agent": "../packages/agent/src/agent/index.ts",
      "@yesimbot/agent": "../packages/agent/src/index.ts",
      "koishi-plugin-yesimbot-workspace": "../plugins/workspace/src/index.ts",
      "koishi-plugin-yesimbot-skill": "../plugins/skill/src/index.ts",
    },
  },
  test: {
    root: ".",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
  },
});
