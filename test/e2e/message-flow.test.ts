import type { Context } from "@koishijs/core";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { createTestApp } from "../setup";

describe("Test App Factory", () => {
  let app: Context;

  beforeAll(async () => {
    app = createTestApp();
    await app.start();
  });

  afterAll(async () => {
    await app?.stop();
  });

  it("should return Koishi Context instance", () => {
    expect(app).toBeDefined();
    expect(app.constructor.name).toBe("Context");
  });

  it("should have mock plugin loaded", () => {
    expect(app.mock).toBeDefined();
  });

  it("should have memory database plugin loaded", () => {
    expect(app.database).toBeDefined();
  });

  it("should start successfully", async () => {
    expect(app.lifecycle.isActive).toBe(true);
  });
});

describe("Message Flow E2E", () => {
  let app: Context;

  beforeAll(async () => {
    app = createTestApp();
    await app.start();
  });

  afterAll(async () => {
    await app?.stop();
  });

  it("should handle direct message scenario", async () => {
    const client = app.mock.client("test-user");

    expect(client).toBeDefined();
    expect(client.userId).toBe("test-user");
  });

  it("should handle group message scenario", async () => {
    const client = app.mock.client("test-user", "test-channel");

    expect(client).toBeDefined();
    expect(client.userId).toBe("test-user");
  });
});
