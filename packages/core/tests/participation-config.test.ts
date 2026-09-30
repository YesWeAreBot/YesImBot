import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentBehaviorConfigSchema } from "../src/agent/config";

test("old configurations receive disabled participation defaults", () => {
    assert.deepEqual(AgentBehaviorConfigSchema({}).participation, {
        enabled: false,
        durationSeconds: 60,
        influence: 0.5,
    });
});

test("enabling participation retains duration and influence defaults", () => {
    assert.deepEqual(AgentBehaviorConfigSchema({ participation: { enabled: true } }).participation, {
        enabled: true,
        durationSeconds: 60,
        influence: 0.5,
    });
});

test("participation schema rejects invalid duration and influence", () => {
    for (const participation of [{ influence: -0.1 }, { influence: 1.1 }, { durationSeconds: 0 }, { durationSeconds: -1 }]) {
        assert.throws(() => AgentBehaviorConfigSchema({ participation }));
    }
});
