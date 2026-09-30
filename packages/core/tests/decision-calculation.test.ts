import { expect, it } from "bun:test";
import { WillingnessManager } from "../src/agent/willing";
import { Services } from "../src/shared/constants";

it("records the exact calculation and single random draw used for replying", () => {
    const manager = new WillingnessManager(
        { on() {}, [Services.Logger]: { getLogger: () => ({ debug() {} }) } } as any,
        {
            base: { text: 12 },
            attribute: { atMention: 100, isQuote: 15, isDirectMessage: 40 },
            interest: { keywords: ["hi"], keywordMultiplier: 1.2, defaultMultiplier: 1 },
            lifecycle: { maxWillingness: 100, probabilityThreshold: 10, probabilityAmplifier: 0.04, replyCost: 35 },
        } as any
    );
    const session: any = {
        cid: "qq:g",
        selfId: "bot",
        userId: "u",
        content: "hi",
        stripped: {},
        elements: [],
        isDirect: false,
        bot: { selfId: "bot" },
        resolve: (v: any) => v,
    };
    const random = Math.random;
    let draws = 0;
    Math.random = () => {
        draws++;
        return 0.12;
    };
    try {
        const result = manager.shouldReply(session, "chat", undefined, 1.5);
        expect(result.calculation).toMatchObject({
            before: 0,
            baseScore: 12,
            interestMultiplier: 1.2,
            marginalMultiplier: 1,
            dynamicMultiplier: 1,
            assessmentMultiplier: 1.5,
            participationMultiplier: 1,
            roll: 0.12,
        });
        expect(result.calculation!.after).toBeCloseTo(21.6);
        expect(result.calculation!.probability).toBeCloseTo(0.464);
        expect(result.decision).toBe(true);
        expect(draws).toBe(1);
    } finally {
        Math.random = random;
    }
});
