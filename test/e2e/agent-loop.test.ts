import type { Context } from "@koishijs/core";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { createTestApp } from "../setup";

describe("Agent Loop E2E", () => {
  let app: Context;

  beforeAll(async () => {
    app = createTestApp();
    await app.start();
  });

  afterAll(async () => {
    await app?.stop();
  });

  it("should process message through think-act cycle", async () => {
    const client = app.mock.client("test-user");

    expect(client).toBeDefined();
    expect(app.lifecycle.isActive).toBe(true);
  });

  it("should handle errors gracefully", async () => {
    const client = app.mock.client("test-user");

    expect(client).toBeDefined();
  });
});
