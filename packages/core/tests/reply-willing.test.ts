import { expect, it } from "bun:test";
import { WillingnessManager } from "../src/agent/willing";
import { Services } from "../src/shared/constants";
it("only counts allowed at gain from a text/at/quote/private message", () => {
    const ctx = { on() {}, [Services.Logger]: { getLogger: () => ({ debug() {} }) } };
    const config = {
        base: { text: 12 },
        attribute: { atMention: 25, isQuote: 15, isDirectMessage: 40 },
        interest: { keywords: [], keywordMultiplier: 1.2, defaultMultiplier: 1 },
        lifecycle: { maxWillingness: 100, probabilityThreshold: 99, probabilityAmplifier: 1 },
    };
    const willing = new WillingnessManager(ctx as any, config as any);
    const session = {
        cid: "onebot:g",
        content: "hi",
        stripped: {},
        elements: [{ type: "at", attrs: { id: "any" } }],
        quote: { user: { id: "bot" } },
        isDirect: true,
        bot: { selfId: "bot" },
        resolve: (v: any) => v,
    };
    willing.shouldReply(session as any, "isolated", ["at"]);
    expect(willing.getCurrentWillingness("isolated")).toBe(25);
    willing.reset("isolated");
    expect(willing.getCurrentWillingness("isolated")).toBe(0);
    willing.shouldReply(session as any, "text-and-quote", ["text", "quote"]);
    expect(willing.getCurrentWillingness("text-and-quote")).toBe(27);
    willing.shouldReply({ ...session, quote: undefined } as any, "text-only", ["text", "quote"]);
    expect(willing.getCurrentWillingness("text-only")).toBe(12);
    willing.shouldReply(session as any, "normal");
    expect(willing.getCurrentWillingness("normal")).toBe(67);
    willing.shouldReply(session as any, "assessed-at-only", ["at"], 0.4);
    expect(willing.getCurrentWillingness("assessed-at-only")).toBe(10);
});
