import { expect, it } from "bun:test";

import { AgentBehaviorConfigSchema } from "../src/agent/config";

it("keeps decision recording off by default with bounded retention", () => {
    const config = AgentBehaviorConfigSchema({});
    expect(config.decisionRecording).toEqual({
        enabled: false,
        directory: "data/yesimbot/decisions",
        maxEntries: 10000,
        maxBytes: 10485760,
        retentionHours: 72,
    });
});

it("rejects invalid journal limits and accepts explicit activation", () => {
    expect(() => AgentBehaviorConfigSchema({ decisionRecording: { maxEntries: 0 } })).toThrow();
    expect(() => AgentBehaviorConfigSchema({ decisionRecording: { maxBytes: 0 } })).toThrow();
    expect(() => AgentBehaviorConfigSchema({ decisionRecording: { retentionHours: 0 } })).toThrow();
    expect(AgentBehaviorConfigSchema({ decisionRecording: { enabled: true } }).decisionRecording?.enabled).toBe(true);
});
