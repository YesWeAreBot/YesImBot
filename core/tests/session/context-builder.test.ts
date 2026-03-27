import { describe, expect, it } from "vitest";

import {
  buildSessionContext,
  convertAgentMessagesToModelMessages,
  type SessionEntry,
} from "../../src/services/session/session-manager";

describe("buildSessionContext", () => {
  it("keeps custom messages as AgentMessage until model conversion", () => {
    const entries: SessionEntry[] = [
      {
        type: "custom_message",
        id: "aaaa1111",
        parentId: null,
        timestamp: new Date().toISOString(),
        customType: "channel_message",
        content: "[alice]: hi",
        display: false,
      },
    ];

    const ctx = buildSessionContext(entries);
    expect(ctx.agentMessages[0]).toMatchObject({ role: "custom", customType: "channel_message" });

    const modelMessages = convertAgentMessagesToModelMessages(ctx.agentMessages);
    expect(modelMessages[0]).toMatchObject({ role: "user" });
  });
});
