/* eslint-disable test/no-import-node-test -- test:quotes 脚本使用 node --test 运行本文件 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Session } from "@satorijs/core";

/**
 * 回归测试：fix(core) preserve native quoted messages in model context (#187)
 *
 * EventListener.recordUserMessage 使用 `session.toJSON().message?.content` 还原
 * 被分离到 `session.quote` 的原生引用元素。本测试锁定该还原行为，防止后续改动
 * 回退成直接使用 `session.content`（该 getter 会把 quote 元素从正文中剥离）。
 */

function createSession(content: string): Session {
    const session = Object.create(Session.prototype);
    session.sn = 1;
    session.bot = { toJSON: () => ({ id: "bot", name: "Bot" }) };
    session.event = { type: "message", message: { id: "m1" } };
    session.content = content;
    return session;
}

describe("session.toJSON().message.content", () => {
    it("普通消息（无引用）原样保留", () => {
        const session = createSession("hello <at id=\"1\"/> world");
        const json = session.toJSON();
        assert.equal(json.message?.content, "hello <at id=\"1\"/> world");
    });

    it("带引用的消息：session.content 剥离 quote，toJSON 还原 quote 元素", () => {
        const session = createSession("<quote id=\"q1\" userId=\"u1\" name=\"Alice\" content=\"被引用内容\"/>follow up");

        // 引用被 setter 移出 elements，session.content 不包含 quote 元素
        assert.equal(session.content, "follow up");
        assert.ok(!session.content!.includes("<quote"));

        // toJSON 将 quote 重新编码回原生消息内容
        const json = session.toJSON();
        assert.ok(json.message?.content!.includes("<quote"));
        assert.ok(json.message?.content!.includes("被引用内容"));
        assert.ok(json.message?.content!.includes("follow up"));
        assert.ok(json.message?.quote);
    });
});
