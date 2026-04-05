import { describe, expect, it } from "vitest";

import { SessionManager } from "../../src/services/session/session-manager";
import * as sessionManagerModule from "../../src/services/session/session-manager";

describe("SessionManager canonical materialization", () => {
  it("does not expose legacy read-side context builders", () => {
    expect(sessionManagerModule.buildSessionContext).toBeUndefined();
    expect(sessionManagerModule.convertAgentMessagesToModelMessages).toBeUndefined();
  });

  it("materializes canonical timeline records through getModelMessages", () => {
    const manager = SessionManager.inMemory("discord:channel-1");

    manager.appendTimelineRecord({
      id: "msg-1",
      kind: "channel_message",
      timestamp: 1,
      stage: "ingress",
      visibility: "model",
      materialization: "default",
      message: {
        kind: "channel_message",
        platform: "discord",
        channelId: "channel-1",
        messageId: "msg-1",
        timestamp: 1,
        content: "hi",
        sender: {
          userId: "alice",
          username: "alice",
        },
        isDirect: true,
        atSelf: false,
        isReplyToBot: false,
      },
    });
    manager.appendTimelineRecord({
      id: "notice-1",
      kind: "system_notice",
      timestamp: 2,
      stage: "runtime",
      visibility: "hidden",
      materialization: "hidden",
      subType: "protocol_guidance",
      materializationKey: "hidden",
      notice: "hidden guidance",
    });

    expect(manager.getModelMessages()).toEqual([
      expect.objectContaining({
        role: "user",
        content: expect.stringContaining("hi"),
      }),
    ]);
  });
});
