import { h, type Session } from "koishi";
import { expect, it } from "vitest";

import { isBotMention } from "../src/agent/mention";

const markdown = h("markdown", { content: "[@bot](mqqapi://markdown/mention?at_type=1&at_tinyid=42) hello" });

const session = (elements: h[], platform = "onebot", selfId = "42") => ({ platform, selfId, elements }) as Session;

it("recognizes a QQ Markdown mention without an outer at segment", () => {
    expect(isBotMention(session([markdown]))).toBe(true);
    expect(isBotMention(session([markdown], "onebot", "43"))).toBe(false);
    expect(isBotMention(session([markdown], "mock"))).toBe(false);
    expect(isBotMention(session([h("quote", {}, [markdown])]))).toBe(false);
    expect(isBotMention(session([h.text(markdown.attrs.content)]))).toBe(false);
});
