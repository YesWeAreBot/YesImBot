import { test, expect } from "bun:test";
import InteractionsExtension from "../lib/services/extension/builtin/interactions";
import { Services } from "../src/shared/constants";
const text = (text: string) => ({ type: "text", data: { text } });
const forward = (id: string) => ({ type: "forward", data: { id } });
const node = (...content: any[]) => ({ sender: { user_id: 1, nickname: "A" }, content });
async function read(payloads: Record<string, unknown>) {
    const calls: string[] = [];
    const extension = Object.create(InteractionsExtension.prototype);
    extension.ctx = { logger: { error() {}, debug() {} }, [Services.Asset]: { transform: async (elements: any[]) => elements.join("") } };
    const result = await extension.getForwardMsg({ id: "root", session: { selfId: "bot", onebot: { getForwardMsg: async (id: string) => {
        calls.push(id);
        if (payloads[id] instanceof Error) throw payloads[id];
        return payloads[id];
    } } } } as any);
    return { result, calls };
}
test("expands three forward layers including outermost and does not fetch a fourth", async () => {
    const { result, calls } = await read({ root: [node(text("outer"), forward("two"))], two: [node(text("second"), forward("three"))], three: [node(text("third"), forward("four"))] });
    expect(result.status).toBe("success");
    expect(result.result).toContain("second");
    expect(result.result).toContain("third");
    expect(result.result).toContain("三层");
    expect(calls).toEqual(["root", "two", "three"]);
});
test("caches repeated IDs while preserving both appearances and sibling content", async () => {
    const { result, calls } = await read({ root: [node(forward("two"), text("between"), forward("two"))], two: [node(text("repeat"))] });
    expect(result.result.match(/repeat/g)?.length).toBe(2);
    expect(result.result).toContain("between");
    expect(calls).toEqual(["root", "two"]);
});
test("retains useful content and distinguishes cycles, missing platform data, and API failures", async () => {
    const { result } = await read({ root: [node(text("keep"), forward("root"), forward("missing"), forward("empty"), forward("bad"))], empty: [], bad: new Error("network") });
    expect(result.status).toBe("success");
    for (const word of ["keep", "循环", "未提供", "无有效消息", "获取失败"]) expect(result.result).toContain(word);
});
