// Build the core package before running these runtime configuration regressions.
import { expect, it } from "bun:test";
import { Context, Schema } from "koishi";
import YesImBot from "../lib";
import { Config } from "../lib/config";
import { ToolService } from "../lib/services/extension/service";
import { ModelService } from "../lib/services/model/service";
import { Services } from "../lib/shared/constants";

const logger = { extend: () => logger, debug() {}, info() {}, success() {}, warn() {}, error() {} };

it("passes migrated v1 configuration to every child plugin during the first startup", () => {
    const ctx = new Context();
    let saved: Config | undefined;
    const childConfigs: Config[] = [];
    ctx.scope.update = (config) => { saved = config; };
    // Child startup is external to this test: migration and all arguments come from YesImBot.
    ctx.plugin = ((plugin, config) => {
        childConfigs.push(config);
        return { ready: true, ctx: { name: plugin.name } };
    }) as typeof ctx.plugin;
    ctx.notifier = { create() {} } as any;
    const bot = new YesImBot(ctx, {
        version: "1.0.0",
        modelService: { providers: [{ name: "legacy", models: [{ modelId: "legacy-chat" }] }], modelGroups: [], task: {} },
        system: { errorReporting: { enabled: false } },
    } as any);

    expect(saved?.version).toBe("2.0.1");
    expect(bot.config.version).toBe("2.0.1");
    expect(childConfigs).toHaveLength(9);
    for (const childConfig of childConfigs) {
        expect(childConfig.version).toBe("2.0.1");
        expect(childConfig.providers[0].name).toBe("legacy");
        expect(childConfig.providers[0].models[0].modelId).toBe("legacy-chat");
        expect(childConfig.heartbeat).toBe(5);
    }
});

function modelService(input: any) {
    const ctx = new Context();
    ctx[Services.Logger] = { getLogger: () => logger } as any;
    ctx.notifier = { create() {} } as any;
    const updates: Config[] = [];
    ctx.scope.update = (config) => { updates.push(config); };
    const config = Config({ providers: [{ name: "provider", models: [{ modelId: "chat" }] }], ...input });
    return { service: new ModelService(ctx, config), config, updates };
}

it("assigns missing core tasks to an automatically created model group", () => {
    const { service, config, updates } = modelService({});
    expect(config.task).toEqual({ chat: "default", embed: "default" });
    expect(updates).toHaveLength(1);
    expect(updates[0].task).toEqual({ chat: "default", embed: "default" });
    expect(service.useChatGroup("chat")).toBeDefined();
});

it("fills a missing embedding task while preserving a valid chat selection", () => {
    const { config } = modelService({
        modelGroups: [
            { name: "primary", models: [{ providerName: "provider", modelId: "chat" }] },
            { name: "chosen", models: [{ providerName: "provider", modelId: "chat" }] },
        ],
        task: { chat: "chosen" },
    });
    expect(config.task).toEqual({ chat: "chosen", embed: "primary" });
});

it("keeps valid task assignments without saving another configuration", () => {
    const { config, updates } = modelService({
        modelGroups: [{ name: "chosen", models: [{ providerName: "provider", modelId: "chat" }] }],
        task: { chat: "chosen", embed: "chosen" },
    });
    expect(config.task).toEqual({ chat: "chosen", embed: "chosen" });
    expect(updates).toHaveLength(0);
});

it("includes extension fields in the enable form after starting disabled", () => {
    class BuiltinExtension {
        static Config = Schema.object({ limit: Schema.number().min(1).default(5) });
        metadata = { name: "test_extension", builtin: true, description: "test extension" };
        tools = new Map();
    }
    const ctx = new Context();
    const service = Object.create(ToolService.prototype);
    Object.assign(service, { ctx, _logger: logger, tools: new Map(), extensions: new Map() });
    service.register(new BuiltinExtension(), false, { enabled: false, limit: 12 });
    const extensionConfig = ctx.schema.get("toolService.availableExtensions");

    // Toggling enable must expose and validate the same extension options before reloading.
    expect(extensionConfig({ test_extension: { enabled: true } })).toEqual({ test_extension: { enabled: true, limit: 5 } });
});

it("preserves disabled extension options when simplifying and enabling again", () => {
    class BuiltinExtension {
        static Config = Schema.object({ limit: Schema.number().default(5) });
        metadata = { name: "test_extension", builtin: true, description: "test extension" };
        tools = new Map();
    }
    const ctx = new Context();
    const service = Object.create(ToolService.prototype);
    Object.assign(service, { ctx, _logger: logger, tools: new Map(), extensions: new Map() });
    service.register(new BuiltinExtension(), false, { enabled: false, limit: 12 });
    const extensionConfig = ctx.schema.get("toolService.availableExtensions");
    const saved = extensionConfig.simplify({ test_extension: { enabled: false, limit: 12 } });
    expect(saved).toEqual({ test_extension: { enabled: false, limit: 12 } });
    expect(extensionConfig(saved)).toEqual({ test_extension: { enabled: false, limit: 12 } });
    expect(extensionConfig({ test_extension: { ...saved.test_extension, enabled: true } })).toEqual({
        test_extension: { enabled: true, limit: 12 },
    });
});
