import { Schema } from "koishi";
import { expect, it, vi } from "vitest";

import InteractionsExtension from "../src/extension/builtin/interactions";
import QManagerExtension from "../src/extension/builtin/qmanager";
import SearchExtension from "../src/extension/builtin/search";
import { withInnerThoughts } from "../src/extension/decorators";
import { toolJSONSchema } from "../src/extension/json-schema";
import { ToolService } from "../src/extension/service";
import { loggingStub } from "./helpers/yesimbot";
it("describes nested composite constraints without dropping input transforms", () => {
    const input = Schema.intersect([
        Schema.object({ mode: Schema.union([Schema.const("a"), Schema.const("b")]).required() }),
        Schema.object({
            count: Schema.number().min(2).max(8).step(2),
            items: Schema.array(Schema.string().min(1).max(4)).min(1).max(3),
            parsed: Schema.transform(Schema.string().description("JSON input"), JSON.parse),
        }),
    ]);
    const json: any = toolJSONSchema(input);
    expect(json.allOf[1].properties.count).toMatchObject({ type: "number", minimum: 2, maximum: 8, multipleOf: 2 });
    expect(json.allOf[1].properties.items).toMatchObject({ minItems: 1, maxItems: 3, items: { minLength: 1, maxLength: 4 } });
    expect(json.allOf[1].properties.parsed).toMatchObject({ type: "string", description: "JSON input" });
    const tools = new ToolService({} as any, {} as any, { logging: loggingStub(), world: {} } as any);
    tools.registerTool({ name: "composite", description: "test", parameters: input, execute: async () => ({ status: "success" }) });
    expect((tools.getSchema("composite") as any).parametersJSONSchema).toEqual(json);
});
it("keeps offset steps exact when a numeric step is relative to a nonzero minimum", () => {
    expect(toolJSONSchema(Schema.number().min(1).step(2))).toMatchObject({ minimum: 1, "x-step": 2, "x-step-base": 1 });
    expect(toolJSONSchema(Schema.number().min(1).step(2))).not.toHaveProperty("multipleOf");
});

function builtinTools() {
    const logger = loggingStub();
    const ctx: any = { logger: Object.assign(() => logger.getLogger(), logger.getLogger()), on() {}, puppeteer: {} };
    const tools = new ToolService(ctx, {} as any, { logging: logger, world: {} } as any);
    ctx.yesimbot = { tool: tools };
    for (const extension of [new SearchExtension(ctx, SearchExtension.Config({})), new InteractionsExtension(ctx, {}), new QManagerExtension(ctx, {})]) {
        for (const definition of (extension as any).tools.values()) tools.registerTool(definition);
    }
    return { tools, ctx };
}

it("keeps the old inner_thoughts input out of tool descriptions and native schemas", () => {
    const { tools } = builtinTools();
    tools.registerTool({ name: "legacy", description: "legacy", parameters: withInnerThoughts({}), execute: async () => ({ status: "success" }) });
    for (const name of ["legacy", "fetch_webpage", "send_poke"]) {
        const definition = tools.getSchema(name)!;
        expect(definition.parameters).not.toHaveProperty("inner_thoughts");
        expect(definition.parametersJSONSchema.properties).not.toHaveProperty("inner_thoughts");
    }
    expect(withInnerThoughts({})({ inner_thoughts: "old input" })).toEqual({ inner_thoughts: "old input" });
});

it("exposes one link-count option and accepts the legacy link opt-out", async () => {
    const { tools, ctx } = builtinTools();
    const extraction = vi.spyOn(SearchExtension.prototype as any, "_fetchAndExtractWithPuppeteer").mockResolvedValue({
        title: "Example",
        textContent: "Page",
        links: [{ url: "https://example.com/next" }],
    });
    try {
        const schema = tools.getSchema("fetch_webpage")!;
        expect(schema.parameters).not.toHaveProperty("include_links");
        expect(schema.parametersJSONSchema.properties).toMatchObject({ max_links: { default: 10, minimum: 0 } });
        expect(schema.parametersJSONSchema.properties).not.toHaveProperty("include_links");
        const session = { app: ctx } as any;
        const url = "https://example.com";
        expect(await tools.invoke("fetch_webpage", { url }, session)).toMatchObject({ result: expect.stringContaining("/next") });
        expect((await tools.invoke("fetch_webpage", { url, max_links: 0 }, session)).result).not.toContain("/next");
        expect((await tools.invoke("fetch_webpage", { url, max_links: 4, include_links: false }, session)).result).not.toContain("/next");
        expect(extraction.mock.calls.map(([, , limit]) => limit)).toEqual([10, 0, 0]);
    } finally {
        extraction.mockRestore();
    }
});

it("uses a consistent guild selector and rejects conflicting aliases before calling the adapter", async () => {
    const { tools } = builtinTools();
    const muteGuildMember = vi.fn(async () => {});
    const request = vi.fn(async () => ({ status: "ok" }));
    const session = { platform: "onebot", guildId: "home", channelId: "thread", bot: { muteGuildMember }, onebot: { _request: request } } as any;
    for (const name of ["send_poke", "ban", "kick"]) {
        const schema = tools.getSchema(name)!;
        expect(schema.parametersJSONSchema.properties).toHaveProperty("guild_id");
        expect(schema.parametersJSONSchema.properties).not.toHaveProperty(name === "send_poke" ? "channel" : "channel_id");
    }
    expect(await tools.invoke("send_poke", { user_id: "123" }, session)).toMatchObject({ status: "success" });
    expect((await tools.invoke("send_poke", { user_id: "123", channel: "legacy" }, session)).status).toBe("success");
    expect(request.mock.calls).toEqual([
        ["group_poke", { group_id: "home", user_id: 123 }],
        ["group_poke", { group_id: "legacy", user_id: 123 }],
    ]);
    expect((await tools.invoke("ban", { user_id: "123", guild_id: "canonical", duration: 1 }, session)).status).toBe("success");
    expect((await tools.invoke("ban", { user_id: "123", guild_id: "canonical", channel_id: "legacy", duration: 1 }, session)).status).toBe("error");
    expect(muteGuildMember.mock.calls).toEqual([["canonical", "123", 60000]]);
});
