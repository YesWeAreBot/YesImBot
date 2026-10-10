import { describe, expect, it } from "bun:test";
import InteractionsExtension from "../lib/services/extension/builtin/interactions";
import { Services } from "../src/shared/constants";
import { formatDate } from "../src/shared/utils/toolkit";

const sender = { user_id: 123, nickname: "Alice" };
const time = 1700000000;
const text = (value: string) => ({ type: "text", data: { text: value } });

async function getForward(payload: unknown, transform?: (elements: any[]) => Promise<string>) {
    const extension = Object.create(InteractionsExtension.prototype);
    extension.ctx = {
        logger: { error() {} },
        [Services.Asset]: { transform: transform || (async (elements: any[]) => elements.join("")) },
    };
    return extension.getForwardMsg({
        session: { selfId: "bot", onebot: { getForwardMsg: async () => payload } },
        id: "forward-id",
    } as any);
}

describe("get_forward_msg payload compatibility", () => {
    it("keeps the sender, Unix-second time and CQ string content", async () => {
        const result = await getForward([{ sender, time, content: "hello[CQ:at,qq=456]" }]);
        expect(result.status).toBe("success");
        expect(result.result).toContain(formatDate(new Date(time * 1000), "YYYY-MM-DD HH:mm:ss"));
        expect(result.result).toContain("Alice(123)");
        expect(result.result).toContain('hello<at id="456"/>');
    });

    for (const field of ["content", "message"]) {
        it(`reads ${field} message-segment arrays without losing image, mention, quote or forward`, async () => {
            const result = await getForward([{
                sender, time,
                [field]: [text("hello"), { type: "image", data: { url: "https://example.test/image.png" } },
                    { type: "at", data: { qq: "all" } }, { type: "reply", data: { id: "quoted" } },
                    { type: "forward", data: { id: "nested" } }],
            }]);
            expect(result.status).toBe("success");
            expect(result.result).toContain('hello<img src="https://example.test/image.png"/>');
            expect(result.result).toContain('<at type="all"/>');
            expect(result.result).toContain('<quote id="quoted"/>');
            expect(result.result).toContain('<forward id="nested"/>');
        });
    }

    it("reads NapCat template nodes with data.user_id and data.nickname", async () => {
        const result = await getForward([{ type: "node", data: { user_id: 123, nickname: "Alice", time, message: [text("NapCat body")] } }]);
        expect(result.status).toBe("success");
        expect(result.result).toContain("Alice(123)");
        expect(result.result).toContain("NapCat body");
    });

    it("uses a populated message array when a template node also has an empty content array", async () => {
        const result = await getForward([{ type: "node", data: { name: "Bob", uin: "456", time, content: [], message: [text("template body")] } }]);
        expect(result.status).toBe("success");
        expect(result.result).toContain("template body");
        expect(result.result).not.toContain("（空消息）");
    });

    it("keeps nonempty content ahead of an alternate message body", async () => {
        const result = await getForward([{ sender, time, content: "primary body", message: [text("alternate body")] }]);
        expect(result.status).toBe("success");
        expect(result.result).toContain("primary body");
        expect(result.result).not.toContain("alternate body");
    });

    it("does not disguise a malformed alternate message as an empty content node", async () => {
        const result = await getForward([{ sender, time, content: [], message: {} }]);
        expect(result.status).toBe("error");
    });

    for (const field of ["content", "message"]) {
        it(`reads a node.data.${field} wrapper with the node sender`, async () => {
            const result = await getForward([{ type: "node", data: { name: "Bob", uin: "456", time, [field]: [text("wrapped")] } }]);
            expect(result.status).toBe("success");
            expect(result.result).toContain("Bob(456)");
            expect(result.result).toContain("wrapped");
        });
    }

    it("keeps nested node content and sender instead of stringifying the array", async () => {
        const result = await getForward([{ sender, time, message: [{ type: "node", data: {
            name: "Bob", uin: "456", content: [text("inner message")],
        } }] }]);
        expect(result.status).toBe("success");
        expect(result.result).toContain("Alice(123)");
        expect(result.result).toContain("Bob(456)");
        expect(result.result).toContain("inner message");
        expect(result.result).not.toContain("[object Object]");
    });

    it("accepts a valid empty response without claiming a formatting failure", async () => {
        const result = await getForward([]);
        expect(result.status).toBe("success");
        expect(result.result).toBe("无有效消息内容");
    });

    it("marks an empty node body explicitly while preserving its sender", async () => {
        const result = await getForward([{ sender, time, message: [] }]);
        expect(result.status).toBe("success");
        expect(result.result).toContain("Alice(123)");
        expect(result.result).toContain("（空消息）");
    });

    for (const payload of [undefined, null, {}, [null], [{ sender, time }], [{ sender, time, content: {} }],
        [{ sender, time, message: [null] }], [{ sender, time, message: [{ type: "text", data: {} }] }],
        [{ sender, time, message: [{ type: "image", data: {} }] }], [{ sender, time: "invalid", content: "body" }]]) {
        it(`returns Failed for an invalid payload: ${JSON.stringify(payload)}`, async () => {
            const result = await getForward(payload);
            expect(result.status).toBe("error");
            expect(result.error?.message).toBeTruthy();
        });
    }

    it("rejects a non-string image source rather than reporting a usable image", async () => {
        const result = await getForward([{ sender, time, message: [{ type: "image", data: { url: 123 } }] }]);
        expect(result.status).toBe("error");
        expect(result.error?.message).toContain("image");
    });

    it("fails the batch explicitly when a valid node is followed by a malformed node", async () => {
        const result = await getForward([{ sender, time, content: "good" }, { sender, time }]);
        expect(result.status).toBe("error");
        expect(result.error?.message).toBeTruthy();
    });

    it("returns Failed when asset conversion fails", async () => {
        const result = await getForward([{ sender, time, content: "[CQ:image,file=image.png]" }], async () => {
            throw new Error("asset unavailable");
        });
        expect(result.status).toBe("error");
        expect(result.error?.message).toContain("asset unavailable");
    });

    it("rejects excessive nested nodes with a readable error", async () => {
        let content: any[] = [text("deep")];
        for (let i = 0; i < 10; i++) content = [{ type: "node", data: { name: "Bob", uin: "456", content } }];
        const result = await getForward([{ sender, time, message: content }]);
        expect(result.status).toBe("error");
        expect(result.error?.message).toMatch(/嵌套|深度/);
    });
});
