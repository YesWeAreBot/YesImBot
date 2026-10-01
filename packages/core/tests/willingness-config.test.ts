import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentBehaviorConfigSchema } from "../src/agent/config";

test("normalizing keyword expressions preserves condition branches and fallback keywords", () => {
    const keywords = {
        $switch: {
            branches: [
                { case: { platform: "onebot", isDirect: true }, then: ["books", "music"] },
                { case: { channelId: "123" }, then: [] },
            ],
            default: ["hello"],
        },
    };
    const config = AgentBehaviorConfigSchema({ interest: { keywords } });

    assert.deepEqual(config.interest.keywords, keywords);
    assert.equal(config.interest.keywordMultiplier, 1.2);
    assert.equal(config.interest.defaultMultiplier, 1);
});

test("plain keyword lists and absent keywords keep their existing values", () => {
    assert.deepEqual(AgentBehaviorConfigSchema({ interest: { keywords: ["hello", "world"] } }).interest.keywords, ["hello", "world"]);
    assert.deepEqual(AgentBehaviorConfigSchema({}).interest.keywords, []);
});

test("legacy willingness values remain loadable across scalar and condition configurations", () => {
    const lifecycle = {
        maxWillingness: 1,
        decayHalfLifeSeconds: 1,
        probabilityThreshold: -1,
        probabilityAmplifier: 0,
        replyCost: { $switch: { branches: [{ case: { isDirect: true }, then: -5 }], default: 35 } },
    };

    assert.deepEqual(AgentBehaviorConfigSchema({ lifecycle }).lifecycle, lifecycle);
});
