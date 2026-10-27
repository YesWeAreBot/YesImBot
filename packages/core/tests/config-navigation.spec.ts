import assert from "node:assert/strict";

import { Schema } from "koishi";
import { test } from "vitest";

import { AgentBehaviorConfigSchema } from "../src/agent/config";
import { AssetServiceConfigSchema } from "../src/asset/config";
import { Config, SystemConfigSchema } from "../src/config/config";
import { ToolServiceConfigSchema } from "../src/extension/config";
import { MemoryConfigSchema } from "../src/memory/config";
import { ModelServiceConfigSchema } from "../src/model/config";
import { PromptServiceConfigSchema } from "../src/prompt/config";
import { HistoryConfigSchema } from "../src/world/config";

// The pre-navigation composition: keep the real module schemas, including their
// transforms and provider branches, as the normalization compatibility oracle.
const original = Schema.intersect([
    Schema.object({ version: Schema.union([Schema.string(), Schema.number()]).hidden() }),
    ModelServiceConfigSchema,
    AgentBehaviorConfigSchema,
    PromptServiceConfigSchema,
    MemoryConfigSchema,
    HistoryConfigSchema,
    ToolServiceConfigSchema,
    AssetServiceConfigSchema,
    SystemConfigSchema,
]);

function rootEntries(schema: Schema): Array<[string, Schema]> {
    if (schema.type === "object") return Object.entries(schema.dict!);
    assert.equal(schema.type, "intersect", "navigation must not hide a second validation pass");
    return schema.list!.flatMap(rootEntries);
}

const headings = ["模型服务", "人格与提示词", "回复触发与意愿", "消息处理与工具", "上下文与记忆", "资源处理", "日志、诊断与上报"];

test("core navigation has seven ordered sections with only model and reply expanded", () => {
    const sections = Config.list!.filter((schema) => schema.meta.role === "yib-section");
    assert.deepEqual(
        sections.map((schema) => schema.meta.description),
        headings,
    );
    assert.deepEqual(
        sections.map((schema) => !!schema.meta.collapse),
        [false, true, false, true, true, true, true],
    );
    assert.equal(rootEntries(Config).find(([key]) => key === "version")![1].meta.hidden, true);
});

test("scalar subgroups have independently collapsible presentation boundaries", () => {
    const sections = Config.list!.filter((schema) => schema.meta.role === "yib-section");
    const wrappers = sections.flatMap((schema) => schema.list!).filter((schema) => schema.meta.description);
    assert.deepEqual(
        wrappers.map((schema) => schema.meta.description),
        [
            "提供商与模型",
            "模型组",
            "任务分配",
            "核心记忆文件",
            "提示词模板",
            "模板渲染（高级）",
            "响应范围",
            "直接触发",
            "基础增益",
            "消息调度",
            "工具调用方式",
            "扩展启用",
            "输入预算",
            "图片上下文",
            "历史保留与清理",
            "资源存储",
            "处理限制",
        ],
    );
    for (const wrapper of wrappers) {
        assert.equal(wrapper.meta.role, "yib-subsection");
        assert.equal(wrapper.meta.collapse, true);
    }
});

test("navigation preserves every root path exactly once and reuses native field schemas", () => {
    const before = new Map(rootEntries(original));
    const after = rootEntries(Config);
    assert.deepEqual(after.map(([key]) => key).sort(), [...before.keys()].sort());
    assert.equal(new Set(after.map(([key]) => key)).size, after.length);
    for (const [key, field] of after) {
        if (key === "version") continue;
        if (key === "advanced") {
            assert.equal(field.dict, before.get(key)!.dict);
            assert.equal(field.meta.description, "工具执行限制");
        } else {
            // Identity preserves every descendant path, transform, computed
            // branch, dynamic reference and native control, not just its type.
            assert.equal(field, before.get(key), key);
        }
    }
});

const fixtures = [
    {},
    {
        version: "2.0.1",
        unknownOption: { keep: true },
        base: { text: JSON.parse('{"$switch":{"branches":[{"case":{"platform":"onebot"},"then":27}],"default":12}}') },
    },
    {
        providers: [
            { name: "default", models: [{ modelId: "a", contextLimit: { mode: "custom", value: "128K" } }] },
            {
                name: "other",
                type: "OpenAI Compatible",
                baseURL: "https://example.invalid/v1",
                models: [{ modelId: "b", contextLimit: { mode: "auto" }, disableNativeToolCalling: true }],
            },
        ],
        modelGroups: [{ name: "chat", models: [{ providerName: "default", modelId: "a" }] }],
        task: { chat: "chat" },
        extra: { example: { enabled: true, retained: "value" } },
    },
    {
        willingnessPolicy: { algorithm: "legacy", ordinaryGainLimit: 42, replyPenalty: 9 },
        topics: { enabled: false, model: { providerName: "p", modelId: "m" } },
        typesafe: { mode: "off", evaluationModel: { providerName: "p", modelId: "m" }, interests: "saved" },
        continuation: { enabled: false, mode: "willingness", willingnessGain: 18 },
        backgroundTools: { enabled: false, allowedTools: ["saved"], willingness: { succeeded: 3, failed: 2, cancelled: 1 } },
        newMessageStrategy: "skip",
        deferredProcessingTime: 12345,
        contextInputBudgetTokens: 0,
        enableVision: false,
        image: { gifProcessingStrategy: "firstFrame" },
    },
];

test("old configurations normalize identically with defaults and inactive values retained", () => {
    for (const fixture of fixtures) {
        assert.deepEqual(Config(structuredClone(fixture)), original(structuredClone(fixture)));
    }
});

test("navigation retains model capacity and background willingness validation", () => {
    for (const fixture of [
        { providers: [{ name: "p", models: [{ modelId: "m", contextLimit: { mode: "custom", value: "1G" } }] }] },
        { backgroundTools: { willingness: { succeeded: Infinity } } },
        { participation: { influence: 1.1 } },
    ]) {
        assert.throws(() => original(structuredClone(fixture)));
        assert.throws(() => Config(structuredClone(fixture)));
    }
});
