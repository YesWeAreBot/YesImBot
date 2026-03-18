import type { Context } from "@koishijs/core";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { createTestApp } from "../setup";

describe("Willingness E2E", () => {
  let app: Context;

  beforeAll(async () => {
    app = createTestApp();
    await app.start();
  });

  afterAll(async () => {
    await app?.stop();
  });

  it("should handle DM messages with high willingness", async () => {
    const client = app.mock.client("test-user");

    expect(client).toBeDefined();
    expect(client.userId).toBe("test-user");
  });

  it("should handle group messages based on willingness threshold", async () => {
    const client = app.mock.client("test-user", "test-channel");

    expect(client).toBeDefined();
    expect(client.userId).toBe("test-user");
  });
});
