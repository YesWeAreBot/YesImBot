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

  it("should register middleware and receive messages", async () => {
    const received: string[] = [];

    app.middleware((session, next) => {
      if (session.content) {
        received.push(session.content);
      }
      return next();
    });

    const client = app.mock.client("flow-user");
    await client.receive("hello world");

    expect(received).toContain("hello world");
  });

  it("should process messages from different channels independently", async () => {
    const channelMessages: Record<string, string[]> = {} as Record<string, string[]>;

    app.middleware((session, next) => {
      const key = session.channelId ?? "dm";
      if (!channelMessages[key]) channelMessages[key] = [];
      if (session.content) channelMessages[key].push(session.content);
      return next();
    });

    const dmClient = app.mock.client("user-a");
    const groupClient = app.mock.client("user-b", "group-1");

    await dmClient.receive("dm message");
    await groupClient.receive("group message");

    expect(Object.keys(channelMessages).length).toBeGreaterThanOrEqual(2);
  });

  it("should propagate session metadata through middleware chain", async () => {
    const sessionData: Array<{ userId: string; channelId?: string }> = [];

    app.middleware((session, next) => {
      sessionData.push({
        userId: session.userId,
        channelId: session.channelId,
      });
      return next();
    });

    const client = app.mock.client("meta-user", "meta-channel");
    await client.receive("test metadata");

    const match = sessionData.find(
      (s) => s.userId === "meta-user" && s.channelId === "meta-channel",
    );
    expect(match).toBeDefined();
  });
});
