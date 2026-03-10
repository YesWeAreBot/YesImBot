import { describe, expect, it } from "vitest";

import {
  RUNTIME_CONTRACT_VERSION,
  Capabilities,
  CapabilityState,
  Percept,
  Scenario,
} from "../src/services/runtime/contracts";

describe("runtime contracts", () => {
  it("exposes runtime contract module", () => {
    expect(RUNTIME_CONTRACT_VERSION).toBe("54.1");
  });

  it("locks percept to wake-only semantics", () => {
    const percept: Percept = {
      id: "wake-1",
      traceId: "trace-1",
      type: "mention",
      platform: "discord",
      channelId: "c1",
      timestamp: new Date(),
      metadata: { reason: "user mention" },
    };

    expect(percept.type).toBe("mention");
    expect("scenario" in (percept as Record<string, unknown>)).toBe(false);
    expect("view" in (percept as Record<string, unknown>)).toBe(false);
    expect("capabilities" in (percept as Record<string, unknown>)).toBe(false);

    // @ts-expect-error Percept must not absorb Scenario.
    const invalidPercept: Percept = { ...percept, scenario: {} };
    expect(invalidPercept).toBeTruthy();
  });

  it("locks scenario as layered raw and derived sections", () => {
    const scenario: Scenario = {
      raw: {
        self: { id: "bot", name: "athena" },
        environment: {
          type: "group",
          id: "env-1",
          name: "General",
          platform: "discord",
          channelId: "c1",
        },
        entities: [{ id: "u1", type: "user", name: "alice" }],
        timeline: [{ id: "e1", type: "message" }] as unknown[],
        stimulusSource: {
          type: "message",
          messageId: "m1",
          senderId: "u1",
        },
      },
      derived: {
        focus: { topic: "runtime contracts" },
        participants: [{ id: "u1", role: "speaker" }],
        attention: { level: "normal" },
        recentMetrics: { messageCount: 1 },
      },
    };

    expect(scenario.raw).toBeDefined();
    expect(scenario.derived).toBeDefined();
    expect("timeline" in scenario.raw).toBe(true);
    expect("recentMetrics" in scenario.derived).toBe(true);
  });

  it("requires structured core and extended capabilities", () => {
    const unavailable: CapabilityState = {
      status: "unavailable",
      reason: "platform-not-supported",
    };

    const capabilities: Capabilities = {
      core: {
        sendMessage: { status: "available" },
        readHistory: unavailable,
      },
      extended: {
        moderation: unavailable,
      },
    };

    expect(capabilities.core.sendMessage.status).toBe("available");
    expect(capabilities.core.readHistory.status).toBe("unavailable");
    expect(capabilities.extended.moderation.reason).toBe("platform-not-supported");
  });
});
