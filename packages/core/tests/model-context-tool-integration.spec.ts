import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Context, Schema } from "koishi";
import { expect, it } from "vitest";

import { PromptContextBuilder } from "../src/agent/context-builder";
import { HeartbeatProcessor } from "../src/agent/heartbeat-processor";
import { ToolService } from "../src/extension/service";
import { PromptService } from "../src/prompt/service";
import { TableName } from "../src/shared/constants";
import { ContextBuilder } from "../src/world/context-builder";
import { InteractionManager } from "../src/world/interaction-manager";
import { loggingStub } from "./helpers/yesimbot";

const resource = (name: string) => readFileSync(new URL(`../resources/${name}`, import.meta.url), "utf8");

it("continues a real tool-service/journal cycle with one causal result and no reasoning or diagnostic replay", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "model-tool-projection-"));
    const ctx = new Context({ baseDir });
    ctx.baseDir = baseDir;
    const errors: string[] = [];
    const logging = loggingStub({
        debug: (...args: unknown[]) => {
            for (const arg of args) {
                if (arg instanceof Error) errors.push(arg.stack ?? arg.message);
                else if (typeof arg === "string" && /根本原因|堆栈追踪/.test(arg)) errors.push(arg);
            }
        },
        info() {},
        warn() {},
        success() {},
        error: (...args: unknown[]) => errors.push(args.map(String).join(" ")),
    });
    ctx.set("yesimbot", { logging });
    const events: any[] = [];
    const message: any = {
        id: "trigger",
        platform: "mock",
        channelId: "room",
        channelType: "guild",
        content: "CURRENT_USER_QUESTION",
        sender: { id: "user" },
        timestamp: new Date(),
    };
    ctx.set("database", { get: async (table: string) => (table === TableName.Messages ? [message] : table === TableName.SystemEvents ? events : []) } as any);
    const session: any = { platform: "mock", selfId: "bot", channelId: "room", userId: "user", isDirect: false, bot: { selfId: "bot", user: { id: "bot" } } };
    const config: any = {
        advanced: { maxRetry: 0 },
        heartbeat: 3,
        enableVision: false,
        contextInputBudgetTokens: 16000,
        l1_memory: { maxMessages: 100, keepFullTurnCount: 3 },
        l2_memory: { enabled: false },
        l3_memory: { enabled: false },
    };
    const journal = new InteractionManager(ctx, config, logging);
    const dataBuilder = new ContextBuilder(ctx, config, journal, {} as any, {} as any, logging);
    const world: any = {
        buildWorldState: (current: any) => dataBuilder.build(current),
        getConversationState: async () => ({ unknown: true }),
        recordSystemEvent: async (event: any) => {
            events.push(event);
            return true;
        },
    };
    const tools = new ToolService(ctx, config, { world, logging } as any);
    tools.registerTool({
        name: "lookup",
        description: "lookup",
        readOnly: true,
        parameters: Schema.object({ query: Schema.string(), inner_thoughts: Schema.string() }),
        execute: async () => ({ status: "success", result: "UNIQUE_LOOKUP_RESULT" }),
    });
    tools.registerTool({
        name: "send_message",
        description: "send",
        parameters: Schema.object({ message: Schema.string() }),
        execute: async () => ({ status: "success" }),
    });
    const prompt = new PromptService(ctx, {} as any, logging);
    prompt.registerTemplate("agent.system", "FIXED_SYSTEM");
    config.userTemplate = resource("prompts/user_base.txt");
    prompt.registerTemplate("agent.user", config.userTemplate);
    for (const name of ["world_state", "l1_history_item"]) prompt.registerTemplate(`agent.partial.${name}`, resource(`templates/${name}.mustache`));
    const requests: any[] = [];
    const model: any = {
        hasVisionCapability: () => false,
        chat: async (request: any) => {
            requests.push(request);
            const first = requests.length === 1;
            return {
                text: JSON.stringify({
                    thoughts: { observe: "PRIVATE_MODEL_REASON" },
                    actions: first
                        ? [{ function: "lookup", params: { query: "VISIBLE_QUERY", inner_thoughts: "PRIVATE_TOOL_REASON" } }]
                        : [{ function: "send_message", params: { message: "VISIBLE_REPLY" } }],
                    request_heartbeat: first,
                }),
            };
        },
    };
    const builder = new PromptContextBuilder(ctx, config, {
        model,
        world,
        tool: tools,
        logging,
        asset: {} as any,
        memory: { getMemoryBlocksForRendering: () => [] } as any,
    });
    const processor = new HeartbeatProcessor(ctx, config, { model, world, tool: tools, logging, l1: journal, prompt, contextBuilder: builder });
    try {
        const success = await processor.runCycle({ type: "user_message", session, payload: { messageIds: ["trigger"] } } as any);
        expect(errors).toEqual([]);
        expect(success).toBe(true);
        expect(requests).toHaveLength(2);
        const second = JSON.stringify(requests[1].messages);
        expect(second.match(/UNIQUE_LOOKUP_RESULT/g)).toHaveLength(1);
        expect(second).toContain("VISIBLE_QUERY");
        expect(second).toContain("CURRENT_USER_QUESTION");
        expect(second).not.toContain("PRIVATE_MODEL_REASON");
        expect(second).not.toContain("PRIVATE_TOOL_REASON");
        expect(second).not.toContain("<framework_data>");
        expect(second).not.toContain("context_budget");
        const audit = await journal.getAgentHistoryFromFile("mock", "room", 100);
        const observation = audit.events.find((item) => item.type === "agent_observation" && item.function === "lookup");
        expect(observation?.type === "agent_observation" && observation.actionId).toBe(events[0].payload.actionId);
        expect(events[0].payload.requestId).not.toBe(events[0].payload.turnId);
        expect(events[0].payload.receipt).toContain("UNIQUE_LOOKUP_RESULT");
        expect(JSON.stringify(audit.events)).toContain("PRIVATE_MODEL_REASON");
        expect(JSON.stringify(audit.events)).toContain("PRIVATE_TOOL_REASON");
    } finally {
        await ctx.stop();
        await rm(baseDir, { recursive: true, force: true });
    }
});
