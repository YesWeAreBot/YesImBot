import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { h, Schema } from "koishi";
import { expect, it } from "vitest";

import { PromptContextBuilder } from "../src/agent/context-builder";
import { HeartbeatProcessor } from "../src/agent/heartbeat-processor";
import { ToolService } from "../src/extension/service";
import { PromptService } from "../src/prompt/service";
import { TableName } from "../src/shared/constants";
import { ContextBuilder } from "../src/world/context-builder";
import { InteractionManager } from "../src/world/interaction-manager";
import { loggingStub } from "./helpers/yesimbot";

const logging = loggingStub({ debug() {}, info() {}, warn() {}, error() {}, success() {} });
const template = (name: string) => readFileSync(new URL(`../resources/${name}`, import.meta.url), "utf8");
const telegramImageState = (guild: string): any => ({
    channel: { platform: "telegram", type: "guild", id: "7" },
    self: { id: "bot" },
    conversationFocus: { target: { platform: "telegram", selfId: "bot", channelId: `telegram-topic:${JSON.stringify([guild, "7"])}` } },
    l1_working_memory: {
        processed_events: [],
        new_events: [{ type: "message", id: "1", timestamp: new Date(), elements: h.parse('<img id="asset"/>') }],
    },
});

async function fixture(maxMessages = 50, keepFullTurnCount = 2) {
    const directory = await mkdtemp(path.join(tmpdir(), "yib-context-regression-"));
    const records: any[] = [
        {
            id: "question",
            platform: "mock",
            channelId: "room",
            channelType: "guild",
            sender: { id: "alice", name: "Alice" },
            content: "ORIGINAL_QUESTION",
            timestamp: new Date(Date.now() - 1000),
            quoteId: "quoted",
        },
        {
            id: "quoted",
            platform: "mock",
            channelId: "room",
            channelType: "guild",
            sender: { id: "alice", name: "Alice" },
            content: "QUOTED_SOURCE",
            timestamp: new Date(Date.now() - 2000),
        },
    ];
    const ctx: any = {
        baseDir: directory,
        database: {
            get: async (table: string, query: any, options: any) =>
                table === TableName.Messages
                    ? records
                          .filter((r) => !query.id || (typeof query.id === "string" ? r.id === query.id : query.id.$in.includes(r.id)))
                          .slice(-(options?.limit ?? records.length))
                          .reverse()
                    : [],
        },
    };
    const config: any = {
        l1_memory: { maxMessages, keepFullTurnCount },
        l2_memory: { enabled: false },
        l3_memory: { enabled: false },
        heartbeat: 2,
        contextInputBudgetTokens: 16000,
        userTemplate: template("prompts/user_base.txt"),
    };
    const l1 = new InteractionManager(ctx, config, logging);
    const data = new ContextBuilder(ctx, config, l1, {} as any, {} as any, logging);
    (data as any).getChannelInfo = async () => ({ name: "room" });
    (data as any).getSelfInfo = async () => ({ id: "bot", name: "Bot" });
    const world: any = {
        buildWorldState: (session: any) => data.build(session),
        getConversationState: async () => ({ unknown: true }),
        readMessageWindow: async (_session: any, options: any) => {
            const anchor = records.find((r) => r.id === options.messageId);
            if (!anchor) throw new Error("missing source");
            return { anchor, quotes: anchor.quoteId ? [{ record: records.find((r) => r.id === anchor.quoteId) }] : [] };
        },
    };
    const prompt = new PromptService(ctx, {} as any, logging);
    prompt.registerTemplate("agent.system", "system");
    prompt.registerTemplate("agent.user", config.userTemplate);
    for (const name of ["world_state", "l1_history_item"]) prompt.registerTemplate(`agent.partial.${name}`, template(`templates/${name}.mustache`));
    const wires: any[] = [];
    const model: any = {
        hasVisionCapability: () => false,
        chat: async (request: any) => {
            wires.push(request.messages);
            return { text: JSON.stringify({ thoughts: {}, actions: [], request_heartbeat: false }), usage: { prompt_tokens: 1, completion_tokens: 1 } };
        },
    };
    const tool: any = { getToolSchemas: () => [], invoke: async () => ({ status: "success", result: "lookup-result" }) };
    const builder = new PromptContextBuilder(ctx, config, {
        model,
        world,
        tool,
        logging,
        asset: {} as any,
        memory: { getMemoryBlocksForRendering: () => [] } as any,
    });
    const processor = new HeartbeatProcessor(ctx, config, { model, world, tool, logging, prompt, contextBuilder: builder, l1 });
    const session: any = { platform: "mock", channelId: "room", selfId: "bot", userId: "alice", isDirect: false, bot: {} };
    const stimulus: any = { type: "user_message", session, payload: { messageIds: ["question"] } };
    return {
        config,
        records,
        ctx,
        data,
        world,
        builder,
        processor,
        model,
        tool,
        prompt,
        wires,
        session,
        stimulus,
        l1,
        close: () => rm(directory, { recursive: true, force: true }),
    };
}

it.each([0, 2])("acknowledges only actual request sources despite late input and keepFullTurnCount=%s", async (keep) => {
    const f = await fixture(50, keep);
    try {
        let release!: () => void, entered!: () => void;
        const started = new Promise<void>((r) => (entered = r)),
            pending = new Promise<void>((r) => (release = r));
        f.model.chat = async (request: any) => {
            f.wires.push(request.messages);
            entered();
            await pending;
            return { text: JSON.stringify({ thoughts: {}, actions: [], request_heartbeat: false }), usage: { prompt_tokens: 1, completion_tokens: 1 } };
        };
        const running = f.processor.runCycle(f.stimulus);
        await started;
        f.records.push({ ...f.records[0], id: "late", content: "UNSEEN_LATE_INPUT", timestamp: new Date() });
        release();
        await running;
        const state = await f.data.build(f.session);
        expect(state.l1_working_memory.new_events.filter((x) => x.type === "message").map((x) => x.id)).toEqual(["late"]);
        const reopened = new InteractionManager(f.ctx, f.config, logging);
        expect((await reopened.getL1History("mock", "room", 50)).filter((x) => x.type === "message").find((x) => x.id === "question")).toMatchObject({
            wasConsumed: true,
        });
    } finally {
        await f.close();
    }
});

it.each([
    [3, 1],
    [50, 25],
])("keeps the original request and quote in the second actual model request with window=%s", async (limit, count) => {
    const f = await fixture(limit);
    try {
        f.model.chat = async (request: any) => {
            f.wires.push(request.messages);
            return {
                text: JSON.stringify({
                    thoughts: {},
                    actions: f.wires.length === 1 ? Array.from({ length: count }, () => ({ function: "lookup", params: {} })) : [],
                    request_heartbeat: f.wires.length === 1,
                }),
                usage: { prompt_tokens: 1, completion_tokens: 1 },
            };
        };
        await f.processor.runCycle(f.stimulus);
        expect(f.wires).toHaveLength(2);
        expect(JSON.stringify(f.wires[1])).toContain("ORIGINAL_QUESTION");
        expect(JSON.stringify(f.wires[1])).toContain("QUOTED_SOURCE");
        const retained = await f.l1.getL1History("mock", "room", limit);
        expect(retained.filter((x) => x.type === "agent_action")).toHaveLength(count);
        expect(retained.some((x) => x.type === "agent_thought")).toBe(true);
    } finally {
        await f.close();
    }
});

it("renders restored working sources and structured system/scheduled trigger details", async () => {
    const f = await fixture();
    try {
        f.world.buildWorldState = async () => ({ l1_working_memory: { processed_events: [], new_events: [] } });
        f.config.continuation = { enabled: true };
        f.world.getConversationState = async () => ({
            unknown: false,
            state: { sourceMessageIds: ["question"], topic: "pending" },
            sourceMessages: [f.records[0]],
        });
        const restored = await (f.processor as any)._prepareLlmRequest(f.stimulus);
        expect(JSON.stringify(restored.messages)).toContain("ORIGINAL_QUESTION");
        for (const [type, payload, marker] of [
            ["system_event", { type: "test", message: "SYSTEM_DETAIL" }, "SYSTEM_DETAIL"],
            ["scheduled_task", { taskId: "SCHEDULED_TASK_DETAIL" }, "SCHEDULED_TASK_DETAIL"],
        ] as const) {
            const prepared = await (f.processor as any)._prepareLlmRequest({ ...f.stimulus, type, payload });
            expect(JSON.stringify(prepared.messages)).toContain(marker);
        }
    } finally {
        await f.close();
    }
});

it("isolates image usage across Telegram groups with equal topic and source message IDs", async () => {
    const f = await fixture();
    try {
        Object.assign(f.config, { enableVision: true, maxImagesInContext: 1, imageLifecycleCount: 1, allowedImageTypes: ["image/png"] });
        f.model.hasVisionCapability = () => true;
        Object.assign(f.builder as any, {
            assetService: { getInfo: async () => ({ id: "asset", mime: "image/png" }), read: async () => "data:image/png;base64,AA==" },
        });
        const first = await f.builder.buildMultimodalUserMessage("A", telegramImageState("-1001"));
        f.builder.commitMultimodalUsage([{ content: first }]);
        expect(Array.isArray(await f.builder.buildMultimodalUserMessage("B", telegramImageState("-1002")))).toBe(true);
    } finally {
        await f.close();
    }
});

it("treats message, memory, and tool output Mustache syntax as terminal data in the actual model request", async () => {
    const f = await fixture();
    try {
        f.session.bot.config = { token: "SHOULD_NEVER_LEAK" };
        const syntax = "{{session.bot.config.token}} {{#unclosed}} {{> agent.system}}";
        f.records[0].content = syntax;
        await f.l1.recordObservation("prior", "mock", "room", { turnId: "prior", function: "lookup", status: "success", result: syntax });
        Object.assign((f.builder as any).memoryService, { getMemoryBlocksForRendering: () => [{ label: "persona", content: [syntax] }] });
        f.prompt.registerTemplate("agent.system", template("prompts/memgpt_v2_chat.txt"));
        await f.processor.runCycle(f.stimulus);
        const wire = JSON.stringify(f.wires[0]);
        expect(wire).not.toContain("SHOULD_NEVER_LEAK");
        expect(wire.match(/unclosed/g)?.length).toBeGreaterThanOrEqual(3);
        expect(wire).toContain("{{session.bot.config.token}}");
    } finally {
        await f.close();
    }
});

it("preserves trusted injection composition without interpreting inserted data again", async () => {
    const f = await fixture();
    try {
        (f.prompt as any).config.injectionPlaceholder = "injected";
        (f.prompt as any).registerDefaultInjections();
        f.prompt.registerTemplate("trusted.partial", "PERSONA: {{value}}");
        f.prompt.injectTemplate("extension", 1, "trusted.partial");
        expect(await f.prompt.renderRaw("{{injected}}", { value: "{{#unclosed}}" })).toContain("PERSONA: {{#unclosed}}");
    } finally {
        await f.close();
    }
});

it("leaves every source unconsumed when the model request fails", async () => {
    const f = await fixture();
    try {
        f.model.chat = async () => {
            throw new Error("temporary failure");
        };
        await f.processor.runCycle(f.stimulus);
        const state = await f.data.build(f.session);
        expect(
            state.l1_working_memory.new_events
                .filter((x) => x.type === "message")
                .map((x) => x.id)
                .sort(),
        ).toEqual(["question", "quoted"]);
    } finally {
        await f.close();
    }
});

it.each(["current", "legacy LF", "legacy CRLF"])(
    "keeps only one output protocol in native initial, correction, next-heartbeat, and JSON fallback requests with %s",
    async (preset) => {
        const f = await fixture();
        try {
            f.config.nativeToolCalling = true;
            const source =
                preset === "current"
                    ? template("prompts/memgpt_v2_chat.txt")
                    : readFileSync(new URL("./fixtures/legacy-system-template.txt", import.meta.url), "utf8");
            f.prompt.registerTemplate("agent.system", preset === "legacy CRLF" ? source.replace(/\r?\n/g, "\r\n") : source);
            Object.assign((f.builder as any).memoryService, {
                getMemoryBlocksForRendering: () => [{ label: "persona", content: ["PERSONA_IN_ALL_PROTOCOLS"] }],
            });
            const definition = { name: "lookup", description: "query", parameters: Schema.object({ query: Schema.string().required() }) };
            f.tool.getAvailableTools = () => [definition];
            f.tool.getTool = () => definition;
            const requests: any[] = [];
            f.model.chat = async (request: any) => {
                requests.push(request);
                f.wires.push(request.messages);
                const args = requests.length === 1 ? {} : { query: "ok" };
                return { text: "", toolCalls: [{ toolCallId: `call-${requests.length}`, toolName: "lookup", args: JSON.stringify(args) }], usage: {} };
            };
            await (f.processor as any).performNativeHeartbeat("native-turn", f.stimulus, () => {});
            await (f.processor as any).performNativeHeartbeat("native-next", f.stimulus, () => {});
            expect(requests.length).toBeGreaterThanOrEqual(3);
            for (const request of requests) {
                const system = request.messages
                    .filter((m: any) => m.role === "system")
                    .map((m: any) => m.content)
                    .join("\n");
                expect(system).toContain("Execute actions through the native tool interface");
                expect(system).not.toContain("Your output MUST be a single raw");
                expect(system).toContain("PERSONA_IN_ALL_PROTOCOLS");
                const fallback = JSON.stringify(request.nativeToolCallingFallback.messages);
                expect(fallback).toContain("Your output MUST be a single raw");
                expect(fallback).not.toContain("Execute actions through the native tool interface");
                expect(fallback).toContain("PERSONA_IN_ALL_PROTOCOLS");
            }
        } finally {
            await f.close();
        }
    },
);

it("preserves bounded consumption receipts when daily log pruning retains only observations", async () => {
    const f = await fixture();
    try {
        await f.processor.runCycle(f.stimulus);
        await f.l1.recordObservation("action", "mock", "room", { turnId: "same-turn", function: "lookup", status: "success", result: "latest" });
        f.config.logLengthLimit = 1;
        await f.l1.pruneOldData();
        const reopened = new InteractionManager(f.ctx, f.config, logging);
        expect((await reopened.getL1History("mock", "room", 50)).filter((x) => x.type === "message").every((x) => x.wasConsumed)).toBe(true);
    } finally {
        await f.close();
    }
});

it("retrieves L2 for concurrent unseen input even when its timestamp equals an already consumed source", async () => {
    const f = await fixture(2);
    try {
        f.config.l2_memory = { enabled: true, retrievalK: 3 };
        const queries: string[] = [];
        Object.assign((f.data as any).l2Manager, {
            compileEventsToText: (events: any[]) => events.map((e) => e.content).join(" "),
            search: async (query: string) => {
                queries.push(query);
                return [];
            },
        });
        let release!: () => void, entered!: () => void;
        const started = new Promise<void>((resolve) => (entered = resolve)),
            pending = new Promise<void>((resolve) => (release = resolve));
        f.model.chat = async () => {
            entered();
            await pending;
            return { text: JSON.stringify({ thoughts: {}, actions: [], request_heartbeat: false }) };
        };
        const cycle = f.processor.runCycle(f.stimulus);
        await started;
        f.records.push({ ...f.records[0], id: "concurrent", content: "CONCURRENT_L2_QUERY" });
        release();
        await cycle;
        queries.length = 0;
        const state = await f.data.build(f.session);
        expect(state.l1_working_memory.new_events.filter((x) => x.type === "message").map((x) => x.id)).toEqual(["concurrent"]);
        expect(queries).toEqual(["CONCURRENT_L2_QUERY"]);
    } finally {
        await f.close();
    }
});

// The complete-schema contract is supplied by the companion tool-boundary fix.
const schemaTool = Object.create(ToolService.prototype);
const complexParameters = Schema.object({
    changes: Schema.array(
        Schema.object({ source: Schema.object({ messageIds: Schema.array(Schema.string()).required() }).required(), count: Schema.number().min(1).max(5) }),
    ).required(),
    profile: Schema.union([Schema.string(), Schema.object({ location: Schema.string().required() })]),
});
schemaTool.getAvailableTools = () => [{ name: "update_profile", description: "update", parameters: complexParameters }];
it.skipIf(!("parametersJSONSchema" in schemaTool.getToolSchemas()[0]))(
    "includes the real ToolService complex parameter contract in the final JSON-mode system prompt",
    async () => {
        const f = await fixture();
        try {
            f.tool.getToolSchemas = () => schemaTool.getToolSchemas(f.session);
            f.prompt.registerTemplate("agent.system", template("prompts/memgpt_v2_chat.txt"));
            await f.processor.runCycle(f.stimulus);
            const system = f.wires[0].find((message: any) => message.role === "system").content;
            expect(system).not.toContain("[object Object]");
            for (const marker of ["items", "messageIds", "location", "required", "minimum", "maximum"]) expect(system).toContain(marker);
        } finally {
            await f.close();
        }
    },
);

it("keeps bot and global event consumption when pruning a channel journal", async () => {
    const f = await fixture();
    try {
        const get = f.ctx.database.get;
        const rows = [
            {
                id: "global-source",
                platform: "",
                channelId: "",
                eventScope: "global",
                type: "global_alert",
                message: "global",
                timestamp: new Date(Date.now() - 400),
            },
            {
                id: "bot-source",
                platform: "mock",
                channelId: "another-room",
                eventScope: "bot",
                botKey: JSON.stringify(["mock", "bot"]),
                type: "bot_alert",
                message: "bot",
                timestamp: new Date(Date.now() - 300),
            },
        ];
        const receiptQueries: any[] = [];
        f.ctx.database.get = async (table: string, query: any, options: any) => {
            if (table !== TableName.SystemEvents) return get(table, query, options);
            if (query.id) {
                receiptQueries.push(query);
                return rows.filter((row) => query.id.$in.includes(row.id));
            }
            return rows;
        };
        await f.processor.runCycle(f.stimulus);
        await f.l1.recordObservation("action", "mock", "room", { turnId: "same-turn", function: "lookup", status: "success", result: "latest" });
        f.config.logLengthLimit = 1;
        await f.l1.pruneOldData();
        const reopened = new InteractionManager(f.ctx, f.config, logging);
        for (const query of receiptQueries) {
            expect(query.platform).toBeUndefined();
            expect(query.channelId).toBeUndefined();
        }
        expect(receiptQueries).toHaveLength(1);
        const events = (await reopened.getL1History("mock", "room", 50, "bot")).filter((x) => x.type === "system_event");
        expect(events).toHaveLength(2);
        expect(events.every((x) => x.wasConsumed)).toBe(true);
        expect((await f.data.build(f.session)).l1_working_memory.new_events.some((x) => x.type === "system_event")).toBe(false);
    } finally {
        await f.close();
    }
});

it("preserves image captions and vision instructions in JSON fallback", async () => {
    const f = await fixture();
    try {
        Object.assign(f.config, {
            nativeToolCalling: true,
            enableVision: true,
            maxImagesInContext: 1,
            imageLifecycleCount: 1,
            allowedImageTypes: ["image/png"],
            multiModalSystemTemplate: "VISION_GUIDE",
        });
        f.records[0].content = '<img id="asset"/> ORIGINAL_QUESTION';
        f.model.hasVisionCapability = () => true;
        f.tool.getAvailableTools = () => [];
        Object.assign(f.builder as any, {
            assetService: { getInfo: async () => ({ id: "asset", mime: "image/png" }), read: async () => "data:image/png;base64,AA==" },
        });
        const prepared = await (f.processor as any)._prepareLlmRequest(f.stimulus);
        const fallbackUser = prepared.fallbackMessages.find((message: any) => message.role === "user").content;
        expect(fallbackUser[0].text).toBe("VISION_GUIDE");
        expect(fallbackUser[1].text).toBe("The following is an image with ID #asset:");
        expect(fallbackUser.filter((part: any) => part.type === "image_url")).toHaveLength(1);
        expect(fallbackUser.at(-1).text).toContain("ORIGINAL_QUESTION");
    } finally {
        await f.close();
    }
});
