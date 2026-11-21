import { Schema } from "koishi";
import { describe, expect, it } from "vitest";

import { collectConfigFields, createConfigLayout, readConfigEntry, writeConfigEntry } from "../client/config-layout";
import { Config } from "../src/config/config";

const dynamic = () => ({
    "toolService.availableExtensions": Schema.object({
        core_util: Schema.intersect([
            Schema.object({ enabled: Schema.boolean().default(true) }),
            Schema.union([
                Schema.object({
                    enabled: Schema.const(true),
                    vision: Schema.object({ model: Schema.dynamic("modelService.selectableModels"), timeoutMs: Schema.number().default(0) }),
                    typing: Schema.object({ maxDelay: Schema.number().default(4000) }),
                    deliveryTimeoutMs: Schema.number().default(0),
                    future: Schema.string(),
                }),
                Schema.object({
                    vision: Schema.any().hidden(),
                    typing: Schema.any().hidden(),
                    deliveryTimeoutMs: Schema.any().hidden(),
                    future: Schema.string().hidden(),
                }),
            ]),
        ]),
        third_party: Schema.object({ enabled: Schema.boolean().default(true), arbitrary: Schema.string() }),
    }),
});
const entries = (layout: ReturnType<typeof createConfigLayout>) => layout.flatMap((group) => group.groups.flatMap((group) => group.entries));

function leafFields(schema: any, registry: Record<string, any>, prefix = "", result = new Map<string, any>()) {
    if (!schema || schema.meta?.hidden || schema.type === "const" || schema.type === "transform") return result;
    const hydrated = schema.meta?.role === "dynamic" && registry[schema.meta.extra?.name];
    if (hydrated) return leafFields(hydrated, registry, prefix, result);
    if (schema.type === "object") {
        for (const [key, child] of Object.entries(schema.dict ?? {})) leafFields(child, registry, prefix ? `${prefix}.${key}` : key, result);
    } else if (schema.type === "intersect" || (schema.type === "union" && !schema.list.every((item: any) => item.type === "const"))) {
        for (const child of schema.list ?? []) leafFields(child, registry, prefix, result);
    } else if (schema.type === "array" && schema.inner?.type === "object") {
        leafFields(schema.inner, registry, `${prefix}[]`, result);
    } else {
        result.set(prefix, { type: schema.type, meta: schema.meta });
    }
    return result;
}

describe("purpose-based configuration layout", () => {
    it("has seven categories and maps every visible root field exactly once", () => {
        const layout = createConfigLayout(Config, {}, {});
        expect(layout).toHaveLength(7);
        const fields = collectConfigFields(Config);
        const actual = entries(layout).map((entry) => entry.path.join("."));
        expect(new Set(actual).size).toBe(actual.length);
        expect([...actual].sort()).toEqual(
            Object.entries(fields)
                .filter(([, schema]) => !schema.meta.hidden)
                .map(([key]) => key)
                .sort(),
        );
        expect(entries(layout).find((entry) => entry.path[0] === "ignoreSelfMessage")!.schema.type).toBe("boolean");
        expect(entries(layout).find((entry) => entry.path[0] === "providers")!.schema).toBe(fields.providers);
        expect(entries(layout).find((entry) => entry.path[0] === "modelGroups")!.schema.meta.role).toBe("yib-model-groups");
    });
    it("shows minor settings as native rows inside their category and keeps feature settings foldable", () => {
        const layout = createConfigLayout(Config, dynamic(), {});
        const rows = (category: string) => layout.find(({ id }) => id === category)!.groups;
        const groupFor = (category: string, path: string) => rows(category).find((group) => group.entries.some((entry) => entry.path.join(".") === path))!;
        expect(groupFor("memory", "ignoreSelfMessage").fold).toBe(false);
        expect(groupFor("memory", "coreMemoryPath").fold).toBe(false);
        expect(groupFor("vision", "enableVision").fold).toBe(false);
        expect(groupFor("vision", "multiModalSystemTemplate").fold).toBe(false);
        expect(groupFor("tools", "nativeToolCalling").fold).toBe(false);
        expect(groupFor("tools", "streamAction").fold).toBe(false);
        expect(groupFor("reply", "typesafe").fold).toBe(true);
        expect(groupFor("memory", "l2_memory").fold).toBe(true);
        expect(groupFor("memory", "onebotHistory").id).toBe("l1");
        expect(groupFor("vision", "extra.core_util.vision").fold).toBe(true);
        expect(groupFor("tools", "extra.third_party").fold).toBe(true);
        const entry = groupFor("memory", "ignoreSelfMessage").entries.find(({ path }) => path[0] === "ignoreSelfMessage")!;
        expect(entry.schema.type).toBe("boolean");
        expect(writeConfigEntry({ ignoreSelfMessage: false, contextInputBudgetTokens: 2048 }, entry, true)).toEqual({
            ignoreSelfMessage: true,
            contextInputBudgetTokens: 2048,
        });
    });

    it("projects vision into one place and preserves its native dynamic model selector", () => {
        const layout = createConfigLayout(Config, dynamic(), {});
        const vision = layout.find((group) => group.id === "vision")!;
        const auxiliary = entries([vision]).find((entry) => entry.path.join(".") === "extra.core_util.vision")!;
        expect(auxiliary.schema.dict!.model.meta).toMatchObject({ role: "dynamic", extra: { name: "modelService.selectableModels" } });
        const core = entries(layout).find((entry) => entry.path.join(".") === "extra.core_util")!;
        expect(collectConfigFields(core.schema)).not.toHaveProperty("vision");
        expect(collectConfigFields(core.schema)).not.toHaveProperty("typing");
        expect(collectConfigFields(core.schema)).not.toHaveProperty("deliveryTimeoutMs");
        expect(entries(layout).filter((entry) => entry.path.join(".") === "extra.core_util.vision")).toHaveLength(1);
    });
    it("reacts to late dynamic schemas and respects a disabled extension without losing values", () => {
        const config = { extra: { core_util: { enabled: false, vision: { timeoutMs: 4567 }, typing: { maxDelay: 9000 } } } };
        expect(entries(createConfigLayout(Config, {}, config)).some((entry) => entry.path.join(".") === "extra")).toBe(true);
        const disabled = createConfigLayout(Config, dynamic(), config);
        expect(entries(disabled).some((entry) => entry.path.join(".") === "extra.core_util.vision")).toBe(false);
        expect(entries(disabled).some((entry) => entry.path.join(".") === "extra.core_util.typing")).toBe(false);
        const core = entries(disabled).find((entry) => entry.path.join(".") === "extra.core_util")!;
        const enabled = writeConfigEntry(config, core, { enabled: true, future: "keep" });
        expect(enabled.extra.core_util.vision).toEqual({ timeoutMs: 4567 });
        expect(entries(createConfigLayout(Config, dynamic(), enabled)).some((entry) => entry.path.join(".") === "extra.core_util.vision")).toBe(true);
        expect(entries(disabled).find((entry) => entry.path.join(".") === "extra.third_party")).toBeDefined();
    });
    it("merges projected edits without replacing sibling fields and keeps initial input immutable", () => {
        const input = {
            custom: { unknown: 42 },
            extra: {
                core_util: { enabled: true, vision: { model: { providerName: "p", modelId: "m" }, timeoutMs: 6000 }, typing: { maxDelay: 9000 }, future: "x" },
                third_party: { arbitrary: "saved" },
            },
        };
        const layout = createConfigLayout(Config, dynamic(), input);
        const vision = entries(layout).find((entry) => entry.path.join(".") === "extra.core_util.vision")!;
        const changed = writeConfigEntry(input, vision, { ...readConfigEntry(input, vision), timeoutMs: 12345 });
        expect(changed.extra.core_util.vision.timeoutMs).toBe(12345);
        expect(changed.extra.core_util.typing).toEqual(input.extra.core_util.typing);
        expect(changed.extra.third_party).toEqual(input.extra.third_party);
        expect(changed.custom).toEqual(input.custom);
        expect(input.extra.core_util.vision.timeoutMs).toBe(6000);
        const core = entries(layout).find((entry) => entry.path.join(".") === "extra.core_util")!;
        expect(readConfigEntry(input, core)).not.toHaveProperty("vision");
        expect(writeConfigEntry(changed, core, { enabled: false }).extra.core_util.vision.timeoutMs).toBe(12345);
    });
    it("covers every native leaf field and its metadata without mutating either source schema", () => {
        const registry = dynamic();
        const before = JSON.stringify({ Config, registry });
        const original = leafFields(Config, registry);
        const actual = new Map<string, any>();
        for (const entry of entries(createConfigLayout(Config, registry, {}))) {
            for (const [path, field] of leafFields(entry.schema, registry, entry.path.join("."))) {
                expect(actual.has(path)).toBe(false);
                actual.set(path, field);
            }
        }
        expect([...actual.keys()].sort()).toEqual([...original.keys()].sort());
        for (const [path, field] of actual) expect(field).toEqual(original.get(path));
        expect(JSON.stringify({ Config, registry })).toBe(before);
    });
    it("accepts the console uid/refs graph after native Schema hydration", () => {
        const original = dynamic()["toolService.availableExtensions"];
        const serialized = JSON.parse(JSON.stringify(original));
        expect(serialized).toHaveProperty("uid");
        expect(serialized).toHaveProperty("refs");
        const hydrated = new Schema(serialized);
        const layout = createConfigLayout(Config, { "toolService.availableExtensions": hydrated }, {});
        expect(entries(layout).filter((entry) => entry.path.join(".") === "extra.core_util.vision")).toHaveLength(1);
    });
    it("switches search modes without overwriting saved settings or the draft selections", () => {
        const registry = {
            "toolService.availableExtensions": Schema.object({
                search: Schema.intersect([
                    Schema.object({ enabled: Schema.boolean().default(true) }),
                    Schema.union([
                        Schema.object({
                            enabled: Schema.const(true),
                            endpoint: Schema.string().default("https://legacy.example/search"),
                            sources: Schema.array(Schema.string()),
                            format: Schema.union(["json", "html"]),
                            limit: Schema.number().default(5),
                            engineSelection: Schema.union(["legacy", "configured"]).default("legacy"),
                            strategy: Schema.union(["auto", "parallel"]).default("auto"),
                            engines: Schema.array(Schema.object({ id: Schema.string(), backend: Schema.string() })),
                            selectedEngines: Schema.array(Schema.string()).default([]),
                        }),
                        Schema.object({ selectedEngines: Schema.any().hidden() }),
                    ]),
                ]),
            }),
        };
        const input = {
            extra: {
                search: {
                    endpoint: "https://saved.example/search",
                    sources: ["bing"],
                    format: "json",
                    engineSelection: "legacy",
                    strategy: "parallel",
                    engines: [{ id: "saved", backend: "brave" }],
                    selectedEngines: ["saved"],
                },
            },
        };
        const searchEntries = (config: unknown) => entries(createConfigLayout(Config, registry, config)).filter((entry) => entry.path[1] === "search");
        const [legacy] = searchEntries(input);
        expect(searchEntries(input)).toHaveLength(1);
        expect(collectConfigFields(legacy.schema)).toHaveProperty("endpoint");
        expect(collectConfigFields(legacy.schema)).not.toHaveProperty("engines");
        const configured = writeConfigEntry(input, legacy, { ...readConfigEntry(input, legacy), engineSelection: "configured" });
        const [settings, picker] = searchEntries(configured);
        expect(collectConfigFields(settings.schema)).not.toHaveProperty("endpoint");
        expect(collectConfigFields(settings.schema)).not.toHaveProperty("selectedEngines");
        expect(collectConfigFields(settings.schema)).toHaveProperty("limit");
        expect(picker.path.join(".")).toBe("extra.search.selectedEngines");
        expect(picker.editor).toBe("search-engines");
        const edited = writeConfigEntry(configured, settings, {
            ...readConfigEntry(configured, settings),
            engines: [...configured.extra.search.engines, { id: "new-draft", backend: "exa" }],
        });
        const selected = writeConfigEntry(edited, picker, ["new-draft"]);
        expect(selected.extra.search).toMatchObject({
            endpoint: input.extra.search.endpoint,
            strategy: "parallel",
            engines: [
                { id: "saved", backend: "brave" },
                { id: "new-draft", backend: "exa" },
            ],
            selectedEngines: ["new-draft"],
        });
        const disabled = writeConfigEntry(selected, settings, { ...readConfigEntry(selected, settings), enabled: false });
        expect(searchEntries(disabled)).toHaveLength(1);
        expect(disabled.extra.search.selectedEngines).toEqual(["new-draft"]);
        const [disabledSettings] = searchEntries(disabled);
        const restored = writeConfigEntry(disabled, disabledSettings, { ...readConfigEntry(disabled, disabledSettings), engineSelection: "legacy" });
        expect(restored.extra.search).toMatchObject({ endpoint: input.extra.search.endpoint, selectedEngines: ["new-draft"] });
        expect(searchEntries(restored)).toHaveLength(1);
    });

    it("retains third-party conditional schemas and new core-util fields in their original editor", () => {
        const registry = dynamic();
        const thirdParty = registry["toolService.availableExtensions"].dict!.third_party;
        const core = entries(createConfigLayout(Config, registry, {})).find((entry) => entry.path.join(".") === "extra.core_util")!;
        expect(collectConfigFields(core.schema).future.type).toBe("string");
        const third = entries(createConfigLayout(Config, registry, {})).find((entry) => entry.path.join(".") === "extra.third_party")!;
        expect(third.schema).toBe(thirdParty);
        expect(
            writeConfigEntry({ extra: { core_util: { enabled: true }, third_party: { arbitrary: "kept" } } }, core, { enabled: false }).extra.third_party,
        ).toEqual({ arbitrary: "kept" });
    });
    it("keeps newly added root fields visible and does not change runtime defaults or serialized paths", () => {
        const extended = Schema.intersect([Config, Schema.object({ futureField: Schema.number().default(42) })]);
        const found = entries(createConfigLayout(extended, dynamic(), {})).filter((entry) => entry.path.join(".") === "futureField");
        expect(found).toHaveLength(1);
        expect(found[0].schema.meta.default).toBe(42);
        const restored = new Schema(JSON.parse(JSON.stringify(Config)))({ ignoreSelfMessage: true, extra: { unknown: { keep: "value" } } });
        expect(restored.ignoreSelfMessage).toBe(true);
        expect(restored.extra.unknown.keep).toBe("value");
        expect(restored).not.toHaveProperty("vision");
    });
});
