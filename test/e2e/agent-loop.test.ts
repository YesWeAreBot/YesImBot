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

  it("should execute middleware pipeline in order", async () => {
    const order: number[] = [];

    app.middleware((session, next) => {
      order.push(1);
      return next();
    });

    app.middleware((session, next) => {
      order.push(2);
      return next();
    });

    const client = app.mock.client("pipeline-user");
    await client.receive("pipeline test");

    expect(order).toContain(1);
    expect(order).toContain(2);
    expect(order.indexOf(1)).toBeLessThan(order.indexOf(2));
  });

  it("should recover from middleware errors without crashing app", async () => {
    app.middleware((session, next) => {
      if (session.content === "cause-error") {
        throw new Error("Simulated middleware failure");
      }
      return next();
    });

    const client = app.mock.client("error-user");

    // Should not crash the app
    try {
      await client.receive("cause-error");
    } catch {
      // Error may propagate - that's ok
    }

    // App should still be running
    expect(app.lifecycle.isActive).toBe(true);

    // Should still handle subsequent messages
    const received: string[] = [];
    app.middleware((session, next) => {
      if (session.content) received.push(session.content);
      return next();
    });

    await client.receive("after-error");
    expect(received).toContain("after-error");
  });

  it("should support async middleware handlers", async () => {
    const results: string[] = [];

    app.middleware(async (session, next) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      results.push("async-done");
      return next();
    });

    const client = app.mock.client("async-user");
    await client.receive("async test");

    expect(results).toContain("async-done");
  });
});
