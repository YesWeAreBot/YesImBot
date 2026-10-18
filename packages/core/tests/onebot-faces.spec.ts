import { h } from "koishi";
import { OneBot } from "koishi-plugin-adapter-onebot";
import { expect, it } from "vitest";

import { EventListenerManager } from "../src/world/event-listener";
import { normalizeOneBotMessageContent } from "../src/world/onebot-faces";
import { loggingStub, stubCtx } from "./helpers/yesimbot";

const text = (text: string) => ({ type: "text", data: { text } });
async function record(message: any, extra: any = {}, quote = "") {
    const raw = { message_id: 1, user_id: 7, sender: { user_id: 7, nickname: "User" }, time: 1792284169, message_type: "private", message, ...extra };
    const bot = { platform: "onebot", config: { advanced: {} } };
    const adapted = await OneBot.adaptMessage(bot as any, raw as any);
    const original = structuredClone(raw);
    const recorded: any[] = [];
    const listener: any = new EventListenerManager(
        stubCtx({}),
        { observeChannel: async () => {}, recordMessage: async (row: any) => recorded.push(row) } as any,
        {} as any,
        loggingStub(),
        { transform: async (value: string) => value } as any,
    );
    await listener.recordUserMessage({
        platform: "onebot",
        selfId: "bot",
        userId: "7",
        channelId: "private:7",
        isDirect: true,
        messageId: "1",
        timestamp: raw.time * 1000,
        author: { name: "User" },
        bot,
        content: adapted.content,
        onebot: raw,
        toJSON: () => ({ message: { content: quote + adapted.content } }),
    });
    expect(raw).toEqual(original);
    return recorded[0].content as string;
}

it("preserves new NapCat face metadata and distinguishes an identically named literal text", async () => {
    const content = await record([
        text("我手打 /冤种，后面才是表情："),
        { type: "face", data: { id: "99999", raw: { faceText: "/冤种", faceType: 3 }, chainCount: 2 } },
        text("结束"),
    ]);
    const elements = h.parse(content);
    expect(elements[0].attrs.content).toBe("我手打 /冤种，后面才是表情：");
    expect(elements[1].type).toBe("face");
    expect(elements[1].attrs).toMatchObject({ id: "99999", name: "冤种", platform: "onebot", kind: "super", chainCount: "2" });
    expect(content).not.toContain("[object Object]");
    expect(elements[2].attrs.content).toBe("结束");
});
it("retains LLBot and Lagrange large-face hints and marks unknown names honestly", async () => {
    for (const hint of [{ sub_type: 3 }, { large: true }]) {
        const content = await record([{ type: "face", data: { id: "99999", ...hint } }]);
        expect(h.parse(content)[0].attrs).toMatchObject({ id: "99999", name: "未知QQ表情", kind: "super" });
    }
});
it("recovers an unknown face name from matching native metadata without a text fallback", async () => {
    const content = await record([{ type: "face", data: { id: "99999" } }], {
        raw: { elements: [{ faceElement: { faceIndex: 99999, faceText: "/冤种", faceType: 3 } }] },
    });
    expect(h.parse(content)[0].attrs).toMatchObject({ id: "99999", name: "冤种", kind: "super" });
});
it("recovers only a positionally verified native face fallback and preserves quote/text order", async () => {
    const content = await record(
        [text("前 /冤种 "), text("/冤种"), text(" 后")],
        {
            raw: {
                elements: [
                    { textElement: { content: "前 /冤种 " } },
                    { faceElement: { faceIndex: 99999, faceText: "/冤种", faceType: 3 } },
                    { textElement: { content: " 后" } },
                ],
            },
        },
        '<quote id="quoted"/>',
    );
    const elements = h.parse(content);
    expect(elements[0].toString()).toBe('<quote id="quoted"/>');
    expect(elements[1].attrs.content).toBe("前 /冤种 ");
    expect(elements[2].attrs).toMatchObject({ id: "99999", name: "冤种", kind: "super" });
    expect(elements[3].attrs.content).toBe(" 后");
});
it("never guesses faces from slash names, inconsistent native slots, or markup in text", async () => {
    for (const extra of [{}, { raw: { elements: [{ faceElement: { faceIndex: 99999, faceText: "/其他", faceType: 3 } }] } }]) {
        const content = await record([text('/冤种 <face id="1"/>')], extra);
        expect(h.parse(content).every((element) => element.type === "text")).toBe(true);
        expect(h.parse(content)[0].attrs.content).toBe('/冤种 <face id="1"/>');
    }
});
it("does not fetch detached replies or overwrite a body changed by another plugin", async () => {
    const session: any = {
        platform: "onebot",
        content: "/冤种",
        messageId: "1",
        bot: {
            platform: "onebot",
            config: { advanced: {} },
            getMessage() {
                throw new Error("must not fetch a quote");
            },
        },
        onebot: {
            message_id: 1,
            sender: { user_id: 7 },
            message: [{ type: "reply", data: { id: "quote" } }, text("/冤种")],
            raw: { elements: [{ replyElement: {} }, { faceElement: { faceIndex: 99999, faceText: "/冤种", faceType: 3 } }] },
        },
    };
    const content = await normalizeOneBotMessageContent(session, '<quote id="quote"/>' + session.content);
    expect(content).toContain('<quote id="quote"/>');
    expect(content).toContain('name="冤种"');
    session.content = "其他插件改写了 /冤种";
    expect(await normalizeOneBotMessageContent(session)).toBe(session.content);
    session.platform = "discord";
    expect(await normalizeOneBotMessageContent(session, '<face id="1"/>')).toBe('<face id="1"/>');
});
