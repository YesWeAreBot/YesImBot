const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { transformSync } = require("esbuild");

const logger = { info() {}, debug() {}, warn() {}, error() {}, success() {} };
const Services = { Logger: "logger", Asset: "asset" };
const TableName = { Messages: "messages", SystemEvents: "events", L2Chunks: "chunks", L3Diaries: "diaries" };
function load(name, dependencies) {
    const source = readFileSync(path.resolve(__dirname, `../src/services/worldstate/${name}.ts`), "utf8").replace(/^import .*;\n/gm, "");
    const code = transformSync(source, { loader: "ts", format: "cjs", target: "node20" }).code;
    const mod = { exports: {} };
    new Function("module", "exports", ...Object.keys(dependencies), code)(mod, mod.exports, ...Object.values(dependencies));
    return mod.exports;
}
const { InteractionManager } = load("interaction-manager", { fs, path, uuidv4: () => "id", Services, TableName, h: { parse: () => [] } });
const { HistoryCommandManager } = load("commands", { Services, TableName });
const { EventListenerManager } = load("event-listener", { Services, TableName, Random: { id: () => "random" }, truncate: (s) => s });
const { ContextBuilder } = load("context-builder", { Services, TableName });
const { WorldStateService } = load("service", { Service: class {}, Services, TableName });

test("L1 reads only the requested platform even when channel IDs match", async () => {
    const queries = [];
    const ctx = {
        baseDir: mkdtempSync(path.join(os.tmpdir(), "yib-l1-")),
        logger: { getLogger: () => logger },
        database: {
            get: async (table, query) => {
                queries.push({ table, query });
                return [];
            },
        },
    };
    try {
        await new InteractionManager(ctx, {}).getL1History("onebot", "123", 10);
        assert.deepEqual(
            queries.map((x) => x.query),
            [
                { platform: "onebot", channelId: "123" },
                { platform: "onebot", channelId: "123" },
            ]
        );
    } finally {
        rmSync(ctx.baseDir, { recursive: true, force: true });
    }
});

test("L3 diary lookup includes platform", async () => {
    const queries = [];
    const ctx = {
        logger: { getLogger: () => logger },
        database: {
            get: async (table, query) => {
                queries.push(query);
                return [];
            },
        },
    };
    const builder = new ContextBuilder(ctx, { l3_memory: { enabled: true } }, null, null, null);
    await builder.retrieveL3Memories("onebot", "123");
    assert.equal(queries[0].platform, "onebot");
    assert.equal(queries[0].channelId, "123");
});

test("guild wildcard never admits a direct message", () => {
    const service = Object.create(WorldStateService.prototype);
    service.config = { allowedChannels: [{ platform: "onebot", type: "guild", id: "*" }] };
    assert.equal(service.isChannelAllowed({ platform: "onebot", channelId: "private:42", userId: "42", isDirect: true }), false);
    assert.equal(service.isChannelAllowed({ platform: "onebot", channelId: "123", guildId: "123", isDirect: false }), true);
});

test("clearing private channels keeps guild agent logs", async () => {
    const baseDir = mkdtempSync(path.join(os.tmpdir(), "yib-clear-"));
    const logDir = path.join(baseDir, "data/yesimbot/interactions/onebot");
    mkdirSync(logDir, { recursive: true });
    writeFileSync(path.join(logDir, "private_42.agent.jsonl"), "{}\n");
    writeFileSync(path.join(logDir, "group.agent.jsonl"), "{}\n");
    const database = { remove: async () => ({ removed: 0 }) };
    const l1_manager = new InteractionManager({ baseDir, logger: { getLogger: () => logger }, database }, {});
    let clearAction;
    const history = {
        subcommand() {
            return this;
        },
        option() {
            return this;
        },
        usage() {
            return this;
        },
        example() {
            return this;
        },
        action(callback) {
            clearAction = callback;
            return this;
        },
    };
    new HistoryCommandManager({ logger: l1_manager.ctx.logger, database, command: () => history }, { l1_manager }, {}).register();
    try {
        await clearAction({ session: {}, options: { all: "private" } });
        assert.equal(existsSync(path.join(logDir, "private_42.agent.jsonl")), false);
        assert.equal(existsSync(path.join(logDir, "group.agent.jsonl")), true);
    } finally {
        rmSync(baseDir, { recursive: true, force: true });
    }
});

test("clearing guild channels keeps private agent logs", async () => {
    const baseDir = mkdtempSync(path.join(os.tmpdir(), "yib-guild-clear-"));
    const logDir = path.join(baseDir, "data/yesimbot/interactions/onebot");
    mkdirSync(logDir, { recursive: true });
    writeFileSync(path.join(logDir, "private_42.agent.jsonl"), "{}\n");
    writeFileSync(path.join(logDir, "group.agent.jsonl"), "{}\n");
    try {
        const manager = new InteractionManager({ baseDir, logger: { getLogger: () => logger } }, {});
        await manager.clearAgentHistoryByType("guild");
        assert.equal(existsSync(path.join(logDir, "private_42.agent.jsonl")), true);
        assert.equal(existsSync(path.join(logDir, "group.agent.jsonl")), false);
    } finally {
        rmSync(baseDir, { recursive: true, force: true });
    }
});

test("pending command matching expires stale results and isolates platforms", async () => {
    const events = new Map();
    const ctx = {
        logger: { getLogger: () => logger },
        asset: {},
        database: {
            get: async (_table, q) => (events.has(q.id) ? [events.get(q.id)] : []),
            set: async (_table, q, update) => events.set(q.id, { ...events.get(q.id), ...update }),
        },
    };
    const listener = new EventListenerManager(ctx, { recordSystemEvent: async (e) => events.set(e.id, e) }, {});
    const session = (platform, id) => ({
        platform,
        channelId: "same",
        cid: `${platform}:same`,
        scope: "scope",
        userId: "u",
        messageId: id,
        author: { name: "u" },
        content: "result",
    });
    await listener.handleCommandInvocation({ session: session("onebot", "first"), command: { name: "test" }, source: "test" });
    await listener.matchCommandResult(session("other", "second"));
    assert.equal(events.get("cmd_invoked_first").payload.result, undefined);
    const pending = listener.pendingCommands.get("onebot:same");
    pending[0].timestamp -= 6 * 60 * 1000;
    await listener.matchCommandResult(session("onebot", "first"));
    assert.equal(events.get("cmd_invoked_first").payload.result, undefined);
    assert.equal(listener.pendingCommands.has("onebot:same"), false);
});

test("idle pending commands are pruned by the managed timer", () => {
    let tick;
    let disposed = false;
    const ctx = {
        logger: { getLogger: () => logger },
        asset: {},
        setInterval: (callback) => {
            tick = callback;
            return () => {
                disposed = true;
            };
        },
    };
    const listener = new EventListenerManager(ctx, {}, {});
    listener.registerEventListeners = () => {};
    listener.start();
    listener.pendingCommands.set("onebot:same", [{ timestamp: Date.now() - 6 * 60 * 1000 }]);
    tick();
    assert.equal(listener.pendingCommands.size, 0);
    listener.stop();
    assert.equal(disposed, true);
});

test("streamed actions wait for a validated model result and are not replayed on failure", async () => {
    const source = readFileSync(path.resolve(__dirname, "../src/agent/heartbeat-processor.ts"), "utf8").replace(/^import .*;\n/gm, "");
    const code = transformSync(source, { loader: "ts", format: "cjs", target: "node20" }).code;
    const mod = { exports: {} };
    class StreamParser {
        processText() {}
        async *stream(key) {
            if (key === "actions") yield { function: "send_message", params: { text: "hello" } };
        }
    }
    const response = {
        thoughts: { observe: "", analyze_infer: "", plan: "" },
        actions: [{ function: "send_message", params: {} }],
        request_heartbeat: false,
    };
    new Function("module", "exports", "Services", "StreamParser", "JsonParser", "uuidv4", code)(
        mod,
        mod.exports,
        Services,
        StreamParser,
        class {
            parse() {
                return { data: response, error: null };
            }
        },
        () => "turn"
    );
    let finish;
    let invoked = 0;
    const model = {
        chat: ({ validation }) => {
            validation.validator('{"actions":[]}', false);
            return new Promise((resolve, reject) => {
                finish = { resolve, reject };
            });
        },
    };
    const history = { recordThought: async () => {}, recordAction: async () => "action", recordObservation: async () => {} };
    const processor = new mod.exports.HeartbeatProcessor(
        { logger: { getLogger: () => logger } },
        {},
        model,
        {},
        {
            invoke: async () => {
                invoked++;
                return { status: "success" };
            },
        },
        history,
        {}
    );
    processor._prepareLlmRequest = async () => ({ messages: [] });
    processor.parseAndValidateResponse = () => response;
    const stimulus = { session: { platform: "onebot", channelId: "123", cid: "onebot:123" } };
    const failed = processor.performSingleHeartbeatWithStreaming("turn", stimulus);
    await Promise.resolve();
    assert.equal(invoked, 0);
    finish.reject(new Error("model failed after streaming an action"));
    await assert.rejects(failed, /model failed/);
    assert.equal(invoked, 0);
    const succeeded = processor.performSingleHeartbeatWithStreaming("turn", stimulus);
    await Promise.resolve();
    assert.equal(invoked, 0);
    finish.resolve({ text: JSON.stringify(response) });
    await succeeded;
    assert.equal(invoked, 1);
});
