import { describe, expect, it, vi } from "vitest";

import type { CapabilityResolver } from "../src/services/plugin/types";
import { buildCapabilitiesFromRuntime } from "../src/services/runtime/adapters";

class MockCapabilityRegistry {
  private resolvers: CapabilityResolver[] = [];

  registerCapabilityResolver(resolver: CapabilityResolver): void {
    this.resolvers.push(resolver);
  }

  getCapabilityResolvers(platform?: string): CapabilityResolver["resolver"][] {
    return this.resolvers
      .filter((resolver) => !resolver.platform || resolver.platform === platform)
      .map((resolver) => resolver.resolver);
  }
}

describe("capability resolver framework", () => {
  it("registers resolvers and returns platform-filtered resolver functions", () => {
    const service = new MockCapabilityRegistry();

    const allResolver = vi.fn(() => ({ "social.reaction": { status: "available" as const } }));
    const onebotResolver = vi.fn(() => ({ "member.moderate": { status: "available" as const } }));

    service.registerCapabilityResolver({ resolver: allResolver });
    service.registerCapabilityResolver({ platform: "onebot", resolver: onebotResolver });

    expect(service.getCapabilityResolvers("onebot")).toHaveLength(2);
    expect(service.getCapabilityResolvers("discord")).toHaveLength(1);
  });

  it("builds baseline namespaced capabilities without resolvers", () => {
    const capabilities = buildCapabilitiesFromRuntime({
      session: { isDirect: false, quote: undefined },
      bot: { selfId: "bot-1" },
    });

    expect(capabilities.core["message.send"]?.status).toBe("available");
    expect(capabilities.core["message.reply"]?.status).toBe("unavailable");
    expect(capabilities.core["message.read_history"]?.status).toBe("available");
    expect(capabilities.extended["message.direct"]?.status).toBe("unavailable");
    expect(capabilities.extended["platform.session"]?.status).toBe("available");
  });

  it("merges resolver output with deny-first semantics", () => {
    const capabilities = buildCapabilitiesFromRuntime({
      session: { isDirect: true, quote: { messageId: "q1" }, guildId: "g1" } as never,
      bot: { selfId: "bot-1" },
      resolvers: [
        () => ({
          "social.reaction": { status: "available", source: "resolver:1" },
          "member.moderate": { status: "available", source: "resolver:1" },
        }),
        () => ({
          "member.moderate": {
            status: "unavailable",
            reason: "policy-blocked",
            source: "resolver:2",
          },
          "social.essence": { status: "available", source: "resolver:2" },
        }),
      ],
    } as never);

    expect(capabilities.extended["social.reaction"]?.status).toBe("available");
    expect(capabilities.extended["member.moderate"]?.status).toBe("unavailable");
    expect(capabilities.extended["social.essence"]?.status).toBe("available");
    expect(capabilities.extended["social.essence"]?.source).toBe("resolver:2");
  });
});
