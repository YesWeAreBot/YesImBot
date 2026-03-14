import { describe, expect, it } from "vitest";

import type { FunctionDefinition } from "../src/services/plugin/types";
import { RUNTIME_CONTRACT_VERSION, getCapabilityByKey } from "../src/services/runtime/contracts";
import type {
  CAPABILITY_KEYS,
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
    const perceptRecord = percept as unknown as Record<string, unknown>;
    expect("scenario" in perceptRecord).toBe(false);
    expect("view" in perceptRecord).toBe(false);
    expect("capabilities" in perceptRecord).toBe(false);

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
        timeline: [{ id: "e1", type: "message" }] as Array<Record<string, unknown>>,
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
        "message.send": { status: "available" },
        "message.read_history": unavailable,
      },
      extended: {
        "member.moderate": unavailable,
      },
    };

    expect(capabilities.core["message.send"]?.status).toBe("available");
    expect(capabilities.core["message.read_history"]?.status).toBe("unavailable");
    expect(capabilities.extended["member.moderate"]?.status).toBe("unavailable");
    if (capabilities.extended["member.moderate"]?.status === "unavailable") {
      expect(capabilities.extended["member.moderate"].reason).toBe("platform-not-supported");
    }
  });

  it("supports source on available capability state", () => {
    const state: CapabilityState = {
      status: "available",
      source: "core",
    };

    expect(state.source).toBe("core");
  });

  it("supports source on unavailable capability state", () => {
    const state: CapabilityState = {
      status: "unavailable",
      reason: "missing-session",
      source: "resolver:onebot",
    };

    expect(state.source).toBe("resolver:onebot");
  });

  it("accepts namespaced capability keys in both core and extended", () => {
    const capabilities: Capabilities = {
      core: {
        "message.send": { status: "available", source: "core" },
        "message.reply": { status: "available", source: "core" },
        "message.delete": { status: "unavailable", reason: "not-supported", source: "core" },
        "message.read_history": { status: "available", source: "core" },
        "message.direct": { status: "available", source: "core" },
      },
      extended: {
        "member.moderate": { status: "available", source: "resolver:mod" },
        "social.essence": { status: "unavailable", reason: "platform-not-supported" },
        "social.reaction": { status: "available" },
        "platform.session": { status: "available", source: "core" },
      },
    };

    expect(capabilities.core["message.reply"]?.status).toBe("available");
    expect(capabilities.extended["social.essence"]?.status).toBe("unavailable");
  });

  it("resolves capabilities by namespaced key", () => {
    const capabilities: Capabilities = {
      core: {
        "message.send": { status: "available" },
      },
      extended: {
        "social.reaction": { status: "unavailable", reason: "unsupported" },
      },
    };

    expect(getCapabilityByKey(capabilities, "message.send")?.status).toBe("available");
    expect(getCapabilityByKey(capabilities, "social.reaction")?.status).toBe("unavailable");
    expect(getCapabilityByKey(capabilities, "nonexistent.key")).toBeUndefined();
  });

  it("exposes canonical namespaced capability keys", () => {
    const keys: typeof CAPABILITY_KEYS = {
      MESSAGE_SEND: "message.send",
      MESSAGE_REPLY: "message.reply",
      MESSAGE_DELETE: "message.delete",
      MESSAGE_READ_HISTORY: "message.read_history",
      MESSAGE_DIRECT: "message.direct",
      MEMBER_MODERATE: "member.moderate",
      SOCIAL_ESSENCE: "social.essence",
      SOCIAL_REACTION: "social.reaction",
      PLATFORM_SESSION: "platform.session",
    };

    expect(keys.MESSAGE_SEND).toBe("message.send");
    expect(keys.PLATFORM_SESSION).toBe("platform.session");
  });

  it("supports declarative capability requirements on function definitions", () => {
    const definition = {
      name: "send_message",
      description: "send",
      type: "tool",
      parameters: {} as never,
      handler: async () => ({ success: true }),
      requiredCapabilities: ["message.send"],
      onCapabilityMissing: "hint",
    } as unknown as FunctionDefinition;

    expect(definition.requiredCapabilities).toEqual(["message.send"]);
    expect(definition.onCapabilityMissing).toBe("hint");
  });
});
