import { describe, expect, it } from "vitest";

import { SessionManager } from "../../src/services/session/session-manager";
import * as sessionManagerModule from "../../src/services/session/session-manager";

describe("SessionManager canonical materialization", () => {
  it("does not expose legacy read-side context builders", () => {
    expect(sessionManagerModule.buildSessionContext).toBeUndefined();
    expect(sessionManagerModule.convertAgentMessagesToModelMessages).toBeUndefined();
  });

  it("materializes message entries through getModelMessages while helper entries stay out", () => {
    const manager = SessionManager.inMemory("discord:channel-1");

    manager.appendAthenaMessage({
      type: "user.message",
      timestamp: new Date(1).toISOString(),
      data: {
        messageId: "msg-1",
        senderId: "alice",
        senderName: "alice",
        content: "hi",
      },
    });
    manager.appendRuntimeStateInfo("protocol_guidance", undefined, {
      content: "hidden guidance",
    });

    expect(manager.getModelMessages()).toEqual([
      expect.objectContaining({
        role: "user",
        content: "hi",
      }),
    ]);
  });
});
