import { CQCode } from "koishi-plugin-adapter-onebot";
import { test, expect, vi } from "vitest";

import InteractionsExtension from "../src/services/extension/builtin/interactions";
import { Services } from "../src/shared/constants";
const text = (text: string) => ({ type: "text", data: { text } });
const forward = (id: string) => ({ type: "forward", data: { id } });
const node = (...content: any[]) => ({ sender: { user_id: 1, nickname: "A" }, content });
async function read(payloads: Record<string, unknown>, transform?: (elements: any[]) => Promise<string>) {
    const calls: string[] = [];
    const extension = Object.create(InteractionsExtension.prototype);
    extension.ctx = { logger: { error() {}, debug() {} }, [Services.Asset]: { transform: transform ?? (async (elements: any[]) => elements.join("")) } };
    const result = await extension.getForwardMsg({
        id: "root",
        session: {
            selfId: "bot",
            onebot: {
                getForwardMsg: async (id: string) => {
                    calls.push(id);
                    if (payloads[id] instanceof Error) throw payloads[id];
                    return payloads[id];
                },
            },
        },
    } as any);
    return { result, calls };
}
test("expands three forward layers including outermost and does not fetch a fourth", async () => {
    const { result, calls } = await read({
        root: [node(text("outer"), forward("two"))],
        two: [node(text("second"), forward("three"))],
        three: [node(text("third"), forward("four"))],
    });
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
    const { result } = await read({
        root: [node(text("keep"), forward("root"), forward("missing"), forward("empty"), forward("bad"))],
        empty: [],
        bad: new Error("network"),
    });
    expect(result.status).toBe("success");
    for (const word of ["keep", "循环", "未提供", "无有效消息", "获取失败"]) expect(result.result).toContain(word);
});

test("repeated cached references share the expanded-item budget before asset work", async () => {
    let transforms = 0;
    const { result, calls } = await read(
        {
            root: [node(text("keep"), ...Array.from({ length: 100 }, () => forward("A")))],
            A: [node(...Array.from({ length: 100 }, () => forward("B")))],
            B: [node({ type: "image", data: { url: "https://example.invalid/image.png" } })],
        },
        async () => {
            transforms++;
            return "<img/>";
        },
    );
    expect(result.status).toBe("success");
    expect(result.result).toContain("keep");
    expect(result.result).toContain("展开预算");
    expect(transforms).toBeLessThanOrEqual(512);
    expect(calls).toEqual(["root", "A", "B"]);
    expect(Buffer.byteLength(result.result, "utf8")).toBeLessThanOrEqual(128 * 1024);
});

test("UTF8 output capacity stops before retaining oversized content", async () => {
    const { result } = await read({ root: [node(text("prefix"), text("汉".repeat(100_000)), text("after"))] });
    expect(result.status).toBe("success");
    expect(result.result).toContain("prefix");
    expect(result.result).toContain("展开预算");
    expect(result.result).not.toContain("after");
    expect(Buffer.byteLength(result.result, "utf8")).toBeLessThanOrEqual(128 * 1024);
});

test("keeps ordinary CQ strings mixed with object segments inside the budget", async () => {
    const { result } = await read({ root: [node("hello[CQ:at,qq=2]", text(" between "), "world")] });
    expect(result.status).toBe("success");
    expect(result.result).toContain('hello<at id="2"/> between world');
    expect(result.result).not.toContain("展开预算");
});

test.each([
    { name: "an oversized CQ array string", prefix: "keep", segment: "[CQ:at,qq=1]".repeat(15_000) },
    { name: "a string exceeding the remaining shared capacity", prefix: "keep".repeat(25_000), segment: "[CQ:at,qq=1]".repeat(4_000) },
    { name: "UTF8 bytes exceeding capacity despite fewer characters", prefix: "keep", segment: "汉".repeat(50_000) },
])("rejects $name before CQ parsing or later asset work", async ({ prefix, segment }) => {
    const parse = vi.spyOn(CQCode, "parse");
    const transform = vi.fn(async () => "<img/>");
    try {
        const { result } = await read(
            { root: [node(text(prefix), segment, { type: "image", data: { url: "https://example.invalid/image.png" } })] },
            transform,
        );
        expect(result.status).toBe("success");
        expect(result.result).toContain(prefix);
        expect(result.result).toContain("展开预算");
        expect(Buffer.byteLength(result.result, "utf8")).toBeLessThanOrEqual(128 * 1024);
        expect(parse.mock.calls.map(([input]) => input === segment)).not.toContain(true);
        expect(parse).toHaveBeenCalledTimes(1);
        expect(transform).not.toHaveBeenCalled();
    } finally {
        parse.mockRestore();
    }
});
