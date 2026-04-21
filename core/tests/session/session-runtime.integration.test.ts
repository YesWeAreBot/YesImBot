import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { SessionRuntime, type SessionRuntimeSnapshot } from "../../src/services/session/runtime";
import { SessionManager } from "../../src/services/session/session-manager";
import { createTestSettingsManager } from "./test-settings-manager";

function createRuntime() {
  return new SessionRuntime(
    {
      logger: vi.fn(() => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        level: 2,
      })),
      "yesimbot.model": {
        resolve: vi.fn(() => ({ provider: "test", modelId: "test:model" })),
        resolveRegistration: vi.fn(() => ({
          fullId: "test:model",
          providerId: "test",
          modelId: "model",
          entry: { id: "model", toolCall: true, reasoning: false },
          model: { provider: "test", modelId: "test:model" },
        })),
      },
      "yesimbot.plugin": {
        compileTools: vi.fn(async () => ({ tools: {}, handles: {}, signature: "[]" })),
        buildContext: vi.fn(async () => ({})),
        selectTools: vi.fn(async () => ({
          activeTools: { send_message: {} },
          activeToolNames: ["send_message"],
          responseContext: {},
        })),
        getToolSet: vi.fn(() => ({})),
        getToolDefinitions: vi.fn(() => []),
      },
    } as never,
    {
      bot: { selfId: "bot-self", sendMessage: vi.fn().mockResolvedValue(undefined) } as never,
      sessionManager: SessionManager.inMemory("discord:channel-1"),
      settingsManager: createTestSettingsManager(),
      platform: "discord",
      channelId: "channel-1",
      basePath: "/tmp/athena-test",
    },
  );
}

describe("SessionRuntime integration seams", () => {
  it("exposes explicit runtime snapshot vocabulary", () => {
    expectTypeOf<SessionRuntimeSnapshot>().toMatchTypeOf<{
      busyWindow: object | null;
      pendingFollowUp: object | null;
      responseContext: unknown;
    }>();
  });

  it("rejects raw channel ingress and points callers to AgentSessionService.ingestEvent", async () => {
    const runtime = createRuntime();

    await expect(
      runtime.receive({
        kind: "channel_message",
        platform: "discord",
        channelId: "channel-1",
        sender: { userId: "user-1", username: "alice" },
        content: "hello",
        isDirect: true,
        atSelf: false,
        isReplyToBot: false,
        messageId: "msg-1",
        timestamp: Date.now(),
      }),
    ).rejects.toThrow(/ingestEvent/);
  });

  it("starts idle with an empty message-first session", () => {
    const runtime = createRuntime();

    expect(runtime.getResponseState()).toBe("idle");
    expect((runtime as unknown as { snapshot: SessionRuntimeSnapshot }).snapshot).toBeDefined();
    expect(runtime.sessionManager.getEntries()).toEqual([]);
    expect(runtime.sessionManager.getSessionMessages()).toEqual([]);
  });
});
