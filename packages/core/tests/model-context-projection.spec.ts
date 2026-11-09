import { readFileSync } from "node:fs";

import { expect, it } from "vitest";

import { HeartbeatProcessor } from "../src/agent/heartbeat-processor";
import { PromptService } from "../src/prompt/service";
import { loggingStub, stubCtx } from "./helpers/yesimbot";

const resource = (name: string) => readFileSync(new URL(`../resources/${name}`, import.meta.url), "utf8");
const message = (id: string, content: string, sender = "user"): any => ({
    type: "message",
    id,
    content,
    sender: { id: sender },
    elements: [],
    timestamp: new Date(),
    is_message: true,
});
async function prepare(processed: any[], userTemplate = resource("prompts/user_base.txt"), budget = 16000, activeTurn = "current") {
    const diagnostics: string[] = [];
    const logging = loggingStub({ debug: (text: string) => diagnostics.push(text) });
    const ctx = stubCtx({});
    const prompt = new PromptService(ctx, {} as any, logging);
    prompt.registerTemplate("agent.system", "FIXED_PERSONA ".repeat(300));
    prompt.registerTemplate("agent.user", userTemplate);
    for (const name of ["world_state", "l1_history_item"]) prompt.registerTemplate(`agent.partial.${name}`, resource(`templates/${name}.mustache`));
    const world: any = {
        channel: { platform: "mock", id: "room" },
        self: { id: "bot" },
        l1_working_memory: { processed_events: processed, new_events: [message("trigger", "CURRENT_USER_CORRECTION")] },
    };
    const processor = new HeartbeatProcessor(ctx, { userTemplate, contextInputBudgetTokens: budget } as any, {
        logging,
        prompt,
        model: {} as any,
        tool: {} as any,
        l1: {} as any,
        world: {} as any,
        contextBuilder: {
            build: async () => ({ toolSchemas: [], memoryBlocks: [], worldState: world }),
            buildMultimodalUserMessage: async (text: string) => text,
        } as any,
    });
    const request = await (processor as any)._prepareLlmRequest(
        { type: "user_message", session: { platform: "mock", selfId: "bot", channelId: "room", userId: "user" }, payload: { messageIds: ["trigger"] } },
        activeTurn,
    );
    return { request, diagnostics, world };
}

it("keeps the full budget report in server diagnostics and out of default/custom requests unless explicitly requested", async () => {
    for (const template of [
        undefined,
        "{{#WORLD_STATE}}{{> agent.partial.world_state}}{{/WORLD_STATE}}",
        "{{#WORLD_STATE}}{{memoryBudgetReport}}{{/WORLD_STATE}}",
        `${resource("prompts/user_base.txt").trimEnd()}\n{{#CONTEXT_BUDGET}}<context_budget>{{{CONTEXT_BUDGET}}}</context_budget>{{/CONTEXT_BUDGET}}\n`,
        `${resource("prompts/user_base.txt").trimEnd()}\n{{#CONTEXT_BUDGET}}<context_budget>{{{CONTEXT_BUDGET}}}</context_budget>{{/CONTEXT_BUDGET}}\n`.replace(
            /\n/g,
            "\r\n",
        ),
    ]) {
        const { request, diagnostics } = await prepare([], template, 1);
        expect(JSON.stringify(request.messages)).not.toContain("context_budget");
        expect(JSON.stringify(request.messages)).not.toContain("protected_sources_or_fixed_overhead");
        expect(request.messages[0].content).toBe("FIXED_PERSONA ".repeat(300));
        expect(diagnostics.some((line) => line.includes("protectedOverBudget"))).toBe(true);
    }
    const explicit = await prepare([], "<context_budget>{{{CONTEXT_BUDGET}}}</context_budget>", 1);
    expect(explicit.request.messages[1].content).toContain("protectedOverBudget");
});

it("does not replay raw thoughts or duplicate a model tool receipt, but retains its action and observation", async () => {
    const items: any[] = [
        { type: "agent_thought", turnId: "current", timestamp: new Date(), is_agent_thought: true, observe: "PRIVATE_REASONING", plan: "PRIVATE_REASONING" },
        {
            type: "agent_action",
            turnId: "current",
            timestamp: new Date(),
            is_agent_action: true,
            function: "lookup",
            params: { query: "VISIBLE_QUERY", inner_thoughts: "PRIVATE_REASONING" },
        },
        {
            type: "agent_observation",
            turnId: "current",
            timestamp: new Date(),
            is_agent_observation: true,
            function: "lookup",
            status: "success",
            actionId: "action-1",
            result: "UNIQUE_TOOL_RESULT",
        },
        {
            type: "system_event",
            id: "receipt",
            eventType: "tool-result",
            timestamp: new Date(),
            is_system_event: true,
            message: "DUPLICATE_DIAGNOSTIC",
            eventDetails: JSON.stringify({
                details: {
                    actor: "model",
                    requestId: "unique-invocation",
                    actionId: "action-1",
                    operation: "lookup",
                    status: "success",
                    receipt: "UNIQUE_TOOL_RESULT",
                },
            }),
        },
    ];
    const { request, world } = await prepare(items);
    const text = JSON.stringify(request.messages);
    expect(text).not.toContain("PRIVATE_REASONING");
    expect(text).not.toContain("DUPLICATE_DIAGNOSTIC");
    expect(text).not.toContain("<system_event>");
    expect(text.match(/UNIQUE_TOOL_RESULT/g)).toHaveLength(1);
    expect(text).toContain("VISIBLE_QUERY");
    expect(text).toContain("CURRENT_USER_CORRECTION");
    expect(world.l1_working_memory.processed_events[0].observe).toBe("PRIVATE_REASONING");
});

it("drops stale tool tracks before recent user conversation rather than protecting the previous task", async () => {
    const { request } = await prepare(
        [
            {
                type: "agent_action",
                turnId: "old",
                timestamp: new Date(0),
                is_agent_action: true,
                function: "lookup",
                params: { query: "OLD_ACCOUNT_TOPIC ".repeat(3000) },
            },
            {
                type: "agent_observation",
                turnId: "old",
                timestamp: new Date(0),
                is_agent_observation: true,
                function: "lookup",
                status: "success",
                result: "OLD_ACCOUNT_TOPIC ".repeat(3000),
            },
            message("recent-user", "RECENT_USER_CONVERSATION"),
        ],
        undefined,
        6000,
    );
    const text = JSON.stringify(request.messages);
    expect(text).not.toContain("OLD_ACCOUNT_TOPIC");
    expect(text).toContain("RECENT_USER_CONVERSATION");
    expect(text).toContain("CURRENT_USER_CORRECTION");
});

it("keeps actual assistant dialogue once, with a compact confirmed-send reference and an unchanged audit", async () => {
    const sent = { ...message("sent-id", "VISIBLE_ASSISTANT_REPLY", "bot"), timestamp: new Date(20) };
    const action: any = {
        type: "agent_action",
        actionId: "send-1",
        turnId: "previous",
        timestamp: new Date(10),
        is_agent_action: true,
        function: "send_message",
        params: { message: "VISIBLE_ASSISTANT_REPLY", inner_thoughts: "PRIVATE_SEND_REASON" },
    };
    const observation: any = {
        type: "agent_observation",
        actionId: "send-1",
        turnId: "previous",
        timestamp: new Date(30),
        is_agent_observation: true,
        function: "send_message",
        status: "success",
    };
    const { request } = await prepare([action, sent, observation]);
    const text = JSON.stringify(request.messages);
    expect(text.match(/VISIBLE_ASSISTANT_REPLY/g)).toHaveLength(1);
    expect(text).toContain("sent-id");
    expect(text).not.toContain("PRIVATE_SEND_REASON");
    expect(action.params.message).toBe("VISIBLE_ASSISTANT_REPLY");
});

const receipt = (id: string, actionId: string): any => ({
    type: "system_event",
    id,
    eventType: "tool-result",
    timestamp: new Date(),
    is_system_event: true,
    message: "diagnostic",
    eventDetails: JSON.stringify({
        details: {
            actor: "model",
            requestId: id,
            actionId,
            operation: "lookup",
            status: "success",
            summary: `receipt-${actionId}`,
            receipt: "RAW_TRANSPORT_DIAGNOSTIC",
        },
    }),
});

it("retains unmatched external receipts and matches repeated tool operations only by unique action ID", async () => {
    const observation: any = {
        type: "agent_observation",
        actionId: "lookup-1",
        turnId: "current",
        timestamp: new Date(),
        is_agent_observation: true,
        function: "lookup",
        status: "success",
        result: "FIRST_LOOKUP_RESULT",
    };
    const { request } = await prepare([observation, receipt("event-1", "lookup-1"), receipt("event-2", "lookup-2")]);
    const text = JSON.stringify(request.messages);
    expect(text).not.toContain("receipt-lookup-1");
    expect(text).toContain("receipt-lookup-2");
    expect(text).toContain("FIRST_LOOKUP_RESULT");
    expect(text).not.toContain("RAW_TRANSPORT_DIAGNOSTIC");
});
