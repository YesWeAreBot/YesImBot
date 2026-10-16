import { Element } from "koishi";
import { test, expect, vi } from "vitest";

import InteractionsExtension from "../src/extension/builtin/interactions";
import { stubCtx } from "./helpers/yesimbot";
const text = (text: string) => ({ type: "text", data: { text } });
const forward = (id: string) => ({ type: "forward", data: { id } });
const node = (...content: any[]) => ({ sender: { user_id: 1, nickname: "A" }, content });
const inline = (name: string, content: any[]) => ({ type: "node", data: { name, uin: "2", content } });
async function read(payloads: Record<string, unknown>, transform?: (elements: Element[]) => Promise<string>) {
    const calls: string[] = [];
    const extension = Object.create(InteractionsExtension.prototype);
    extension.ctx = stubCtx({ asset: { transform: transform ?? (async (elements: Element[]) => elements.join("")) } }, { logger: { error() {}, debug() {} } });
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

test("counts outer A, nested B/D and their ordinary contents as levels zero, one and two", async () => {
    const { result, calls } = await read({
        root: [node(text("ordinary-1")), node(forward("B")), node(forward("D"))],
        B: [node(text("ordinary-1.1")), node(forward("C")), node(text("ordinary-1.2"))],
        C: [node(text("must-not-fetch"))],
        D: [node(text("ordinary-2.1"))],
    });
    expect(result.status).toBe("success");
    for (const value of ["ordinary-1", "ordinary-1.1", "ordinary-1.2", "ordinary-2.1"]) expect(result.result).toContain(value);
    expect(result.result).toContain('<forward id="C"/>');
    expect(result.result).toContain("三层展开上限");
    expect(result.result).not.toContain("must-not-fetch");
    expect(calls).toEqual(["root", "B", "D"]);
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

test("keeps over thirty-two distinct legal sibling forwards and more than five hundred messages", async () => {
    const payloads: Record<string, unknown> = {
        root: Array.from({ length: 50 }, (_, i) => node(forward(`sibling-${i}`))),
    };
    for (let i = 0; i < 50; i++) payloads[`sibling-${i}`] = Array.from({ length: 20 }, (_, j) => node(text(`message-${i}-${j};`)));
    const { result, calls } = await read(payloads);
    expect(result.status).toBe("success");
    expect(calls).toHaveLength(51);
    for (let i = 0; i < 50; i++) for (let j = 0; j < 20; j++) expect(result.result).toContain(`message-${i}-${j};`);
    expect(result.result).not.toMatch(/展开预算|32 个/);
});

test("preserves long UTF8 text and following messages without a horizontal byte cap", async () => {
    const longText = "汉".repeat(100_000);
    const { result } = await read({ root: [node(text("prefix"), text(longText), text("after"))] });
    expect(result.status).toBe("success");
    expect(result.result).toContain(`prefix${longText}after`);
    expect(result.result).not.toContain("展开预算");
});

test("preserves all media and mixed CQ text at the deepest legal ordinary-message level", async () => {
    const transform = vi.fn<(elements: Element[]) => Promise<string>>(async (elements) => elements.join(""));
    const { result, calls } = await read(
        {
            root: [node(forward("media"))],
            media: [
                node(
                    "hello[CQ:at,qq=2]",
                    { type: "image", data: { url: "https://example.invalid/image.png" } },
                    { type: "video", data: { url: "https://example.invalid/video.mp4" } },
                    { type: "record", data: { url: "https://example.invalid/voice.ogg" } },
                    { type: "file", data: { name: "report.pdf", url: "https://example.invalid/report.pdf" } },
                    { type: "reply", data: { id: "quoted" } },
                    text("end"),
                ),
            ],
        },
        transform,
    );
    expect(result.status).toBe("success");
    for (const value of ['hello<at id="2"/>', "image.png", "video.mp4", "voice.ogg", "report.pdf", '<quote id="quoted"/>', "end"])
        expect(result.result).toContain(value);
    expect(transform).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["root", "media"]);
});

test("handles inline node containers with the same depth rule as referenced forwards", async () => {
    const { result } = await read({
        root: [node(inline("B", [text("legal-inline"), inline("C", [text("too-deep-inline")])]), text("outer-tail"))],
    });
    expect(result.status).toBe("success");
    expect(result.result).toContain("legal-inline");
    expect(result.result).toContain("outer-tail");
    expect(result.result).not.toContain("too-deep-inline");
    expect(result.result).toContain("三层展开上限");
});

test("preserves repeated legal branches without treating a shared ID as a global cycle", async () => {
    const { result, calls } = await read({ root: Array.from({ length: 600 }, () => node(forward("A"))), A: [node(text("shared-leaf;"))] });
    expect(result.status).toBe("success");
    expect(result.result.match(/shared-leaf;/g)).toHaveLength(600);
    expect(result.result).not.toContain("循环");
    expect(calls).toEqual(["root", "A"]);
});
