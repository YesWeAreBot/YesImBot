import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: ".",
    include: ["src/**/__tests__/**/*.test.ts"],
    setupFiles: ["src/services/agent/__tests__/setup.ts"],
  },
});
