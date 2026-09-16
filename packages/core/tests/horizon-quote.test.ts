import type { Session } from "koishi";
import type { MessageRecord, UserMessagePercept } from "../src/services/horizon/types";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Bot, Context, h } from "koishi";
import { AgentBehaviorConfig } from "../src/agent/config";
import { WillingnessManager } from "../src/agent/willing";
import { DefaultChatMode } from "../src/services/horizon/chat-mode/default-chat";
import { EventManager } from "../src/services/horizon/event-manager";
import { EventListener } from "../src/services/horizon/listener";
import { TimelineStage } from "../src/services/horizon/types";
import { MustacheRenderer } from "../src/services/prompt/renderer";
import { Services, TableName } from "../src/shared/constants";

class TestBot extends Bot<Context> {}

// Use a real Koishi Session so quote extraction and serialization are not mocked.
// Only the database, asset service and plugin service host are test doubles.
async function receiveAndRender(options: {
    quote?: Session["quote"];
    isDirect?: boolean;
    stage?: TimelineStage;
    content?: string;
    next?: (session: Session) => void;
} = {}) {
    const rows: MessageRecord[] = [];
    const templates: Record<string, string> = {};
    const logs: string[] = [];
    let middleware: (session: Session, next: () => Promise<void>) => Promise<void>;
    let percept: UserMessagePercept;
    const ctx = {
        logger: { info() {}, debug(value: string) { logs.push(value); }, error() {} },
        on: () => () => true,
        middleware(fn) { middleware = fn; return () => true; },
        emit(_name, event) { percept = event; },
        [Services.Asset]: { transform: async (value: string) => value },
        [Services.Prompt]: { registerTemplate(name: string, value: string) { templates[name] = value; } },
        database: {
            get: async () => [],
            upsert: async () => {},
            async create(table: string, value) {
                const saved = JSON.parse(JSON.stringify(value));
                if (table === TableName.Timeline) {
                    saved.timestamp = new Date(saved.timestamp);
                    rows.push(saved);
                }
                return saved;
            },
        },
    } as unknown as Context;
    const events = new EventManager(ctx, {} as any);
    events.query = async ({ scope, types, limit }) => rows.filter(row =>
        (!types || types.includes(row.type))
        && Object.entries(scope).every(([key, value]) => row.scope[key] === value),
    ).slice().reverse().slice(0, limit);
    const horizon = {
        events,
        isChannelAllowed: () => true,
        getEnvironment: async () => null,
        getEntities: async () => [],
    };
    const listener = new EventListener(ctx, {} as any, horizon as any);
    listener.start();
    const mode = new DefaultChatMode(ctx, horizon as any);
    const bot = new TestBot(new Context(), {}, "onebot");
    bot.platform = "onebot";
    bot.user = { id: "bot", name: "机器人" };
    const session = bot.session({
        type: "message",
        user: { id: "bob", name: "小李" },
        channel: { id: options.isDirect ? "private-user" : "group-123", type: options.isDirect ? 1 : 0 },
        guild: options.isDirect ? undefined : { id: "group-123" },
        message: { id: "current-message" },
    });
    session.content = options.content ?? "你怎么看？";
    if (options.quote)
        session.quote = options.quote;
    const bodyBefore = session.content;
    const quoteBefore = session.quote;
    const serialized = session.toJSON().message!.content!;
    await middleware!(session, async () => { options.next?.(session); });
    rows[0].stage = options.stage ?? TimelineStage.New;

    // The referenced original is deliberately absent from the history window.
    const result = await mode.buildContext(percept!);
    const prompt = new MustacheRenderer().render(templates[result.templates.user], result.view, templates);
    listener.stop();
    return { prompt, rows, percept: percept!, serialized, session, bodyBefore, quoteBefore, logs };
}

const richContent = '<at id="alice" name="小张"/><at type="all"/>'
    + '<face id="1" platform="onebot"><img src="https://example.invalid/face.png"/></face>'
    + '<img src="https://example.invalid/image.png"/>'
    + '<audio src="https://example.invalid/audio.ogg"/>'
    + '<video src="https://example.invalid/video.mp4"/>'
    + '<file src="https://example.invalid/file.txt" title="附件"/>'
    + '<message id="forwarded"><author id="alice"/>转发正文</message>'
    + '<custom-element data-value="keep">扩展标签</custom-element>';

describe("incoming quoted messages", () => {
    for (const isDirect of [false, true]) {
        for (const stage of [TimelineStage.New, TimelineStage.Active]) {
            it(`preserves native quote XML in ${isDirect ? "private" : "group"} ${stage} messages`, async () => {
                const app = await receiveAndRender({
                    quote: { id: "old-message", content: "明天八点出发", user: { id: "alice", name: "小张" } },
                    isDirect,
                    stage,
                });
                const expected = '<quote id="old-message"><user id="alice" name="小张"/>明天八点出发</quote>你怎么看？';
                assert.equal(app.rows.length, 1);
                assert.equal(app.rows[0].data.content, expected);
                assert.equal(app.percept.payload.content, expected);
                assert.ok(app.prompt.includes(`小李: ${expected}`), app.prompt);
                assert.ok(app.logs.some(line => line.includes(expected)));
                assert.equal(app.session.content, app.bodyBefore);
                assert.equal(app.session.quote, app.quoteBefore);
            });
        }
    }

    it("leaves ordinary text and existing message elements unchanged", async () => {
        const app = await receiveAndRender({ content: `普通消息${richContent}` });
        assert.equal(app.rows[0].data.content, app.bodyBefore);
        assert.equal(app.percept.payload.content, app.bodyBefore);
        assert.ok(app.prompt.includes(app.bodyBefore));
        assert.ok(!app.prompt.includes("<quote"));
    });

    it("preserves rich elements both inside a quote and in the reply", async () => {
        const app = await receiveAndRender({ quote: { id: "q", content: richContent }, content: richContent });
        assert.equal(app.rows[0].data.content, `<quote id="q">${richContent}</quote>${richContent}`);
        assert.ok(app.prompt.includes(app.serialized));
        assert.ok(!app.prompt.includes("&lt;at"));
        assert.ok(!app.prompt.includes("[引用消息"));
    });

    it("round-trips a native quote supplied inline without duplicating it", async () => {
        const content = '<quote id="q"><user id="alice" name="小张"/>原文</quote><at id="bot"/>回复';
        const app = await receiveAndRender({ content });
        assert.equal(app.session.quote?.id, "q");
        assert.equal(app.bodyBefore, '<at id="bot"/>回复');
        assert.equal(app.rows[0].data.content, content);
        assert.equal(app.prompt.match(/<quote\b/g)?.length, 1);
    });

    it("preserves nested quotes using native resource encoding", async () => {
        const app = await receiveAndRender({
            quote: {
                id: "outer", content: "外层正文",
                quote: { id: "inner", content: "内层正文", user: { id: "alice" } },
            },
        });
        assert.ok(app.prompt.includes('<quote id="outer"><quote id="inner"><user id="alice"/>内层正文</quote>外层正文</quote>'));
        assert.equal(app.rows[0].data.content, app.serialized);
    });

    it("keeps an ID-only quote without borrowing the current reply as quoted text", async () => {
        const app = await receiveAndRender({ quote: { id: "missing-message" } });
        assert.equal(app.rows[0].data.content, '<quote id="missing-message"/>你怎么看？');
        assert.ok(app.prompt.includes('<quote id="missing-message"/>你怎么看？'));
        assert.equal(app.prompt.match(/你怎么看？/g)?.length, 1);
    });

    it("preserves a quote when the current reply body is empty", async () => {
        const app = await receiveAndRender({ quote: { id: "q", content: "被引用的唯一内容" }, content: "", isDirect: true });
        assert.equal(app.rows[0].data.content, '<quote id="q">被引用的唯一内容</quote>');
        assert.ok(app.prompt.includes(app.serialized));
    });

    it("keeps the snapshot when downstream middleware changes the session", async () => {
        const app = await receiveAndRender({
            quote: { id: "q", content: "原始引用" },
            next(session) { session.content = "后续中间件改写"; },
        });
        assert.equal(app.rows[0].data.content, app.serialized);
        assert.equal(app.percept.payload.content, app.serialized);
        assert.ok(app.prompt.includes("原始引用"));
        assert.ok(!app.prompt.includes("后续中间件改写"));
    });

    it("uses native metadata elements and escaping for authors and group members", async () => {
        const app = await receiveAndRender({
            quote: {
                id: 'q"&', content: "A &amp; B &lt; C",
                user: { id: "alice", name: '账号"&名' }, member: { name: "群昵称" },
            },
        });
        const quote = h.parse(app.rows[0].data.content)[0];
        assert.equal(quote.type, "quote");
        assert.equal(quote.attrs.id, 'q"&');
        assert.equal(quote.children.find(el => el.type === "user")?.attrs.name, '账号"&名');
        assert.equal(quote.children.find(el => el.type === "member")?.attrs.name, "群昵称");
        assert.ok(app.prompt.includes(app.serialized));
    });

    it("does not reject a forced private reply when the quote author is missing", () => {
        const manager = new WillingnessManager({ on: () => () => true } as any, AgentBehaviorConfig({} as any) as any);
        const session = {
            cid: "onebot:private-user", content: "你怎么看？", quote: { id: "missing-message" },
            bot: { selfId: "bot" }, stripped: { atSelf: false }, elements: [],
            isDirect: true, resolve: value => value,
        } as unknown as Session;
        assert.equal(manager.isForcedReply(session), true);
    });
});
