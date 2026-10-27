import { Schema } from "koishi";

import { AgentBehaviorConfig, AgentBehaviorConfigSchema } from "../agent";
import { AssetServiceConfig, AssetServiceConfigSchema } from "../asset";
import { ToolServiceConfig, ToolServiceConfigSchema } from "../extension";
import { LoggingConfig, LoggingConfigSchema } from "../logger";
import { MemoryConfig, MemoryConfigSchema } from "../memory";
import { ModelServiceConfig, ModelServiceConfigSchema } from "../model";
import { PromptServiceConfig, PromptServiceConfigSchema } from "../prompt";
//import { TelemetryConfig, TelemetryConfigSchema } from "../telemetry";
import { ErrorReporterConfig, ErrorReporterConfigSchema } from "../shared/errors";
import { HistoryConfig, HistoryConfigSchema } from "../world";

export const CONFIG_VERSION = "2.0.1";

export interface SystemConfig {
    logging: LoggingConfig;
    errorReporting: ErrorReporterConfig;
}

export const SystemConfigSchema: Schema<SystemConfig> = Schema.object({
    logging: LoggingConfigSchema.description("日志设置"),
    errorReporting: ErrorReporterConfigSchema.collapse().description("错误上报"),
});

export type Config = ModelServiceConfig &
    AgentBehaviorConfig &
    MemoryConfig &
    HistoryConfig &
    ToolServiceConfig &
    AssetServiceConfig &
    PromptServiceConfig &
    //TelemetryConfig &
    SystemConfig & {
        readonly version: string | number;
    };

// These module roots are presentation-only object/intersect containers. Reuse
// their field schemas whole: nested unions, transforms, computed branches and
// dynamic selectors must remain native and run exactly once.
const fields = new Map<string, Schema>();
for (const schema of [
    ModelServiceConfigSchema,
    AgentBehaviorConfigSchema,
    PromptServiceConfigSchema,
    MemoryConfigSchema,
    HistoryConfigSchema,
    ToolServiceConfigSchema,
    AssetServiceConfigSchema,
    SystemConfigSchema,
]) {
    collectFields(schema);
}

function collectFields(schema: Schema): void {
    if (schema.type === "intersect") {
        for (const child of schema.list ?? []) collectFields(child);
        return;
    }
    // Do not silently flatten a future root union/transform: it may contain
    // conditional or cross-field validation that needs an explicit redesign.
    if (schema.type !== "object") throw new TypeError(`Unsupported configuration root: ${schema.type}`);
    for (const [key, field] of Object.entries(schema.dict ?? {})) {
        if (fields.has(key)) throw new TypeError(`Duplicate configuration field: ${key}`);
        fields.set(key, field);
    }
}

function take(keys: ReadonlyArray<keyof Config>): Schema {
    const dict: Record<string, Schema> = {};
    for (const key of keys) {
        const field = fields.get(key);
        if (!field) throw new TypeError(`Missing or repeated configuration field: ${key}`);
        dict[key] = key === "advanced" ? field.description("工具执行限制") : field;
        fields.delete(key);
    }
    return Schema.object(dict);
}

function subgroup(title: string, keys: ReadonlyArray<keyof Config>): Schema {
    return take(keys).description(title).collapse().role("yib-subsection");
}

function section(title: string, children: Schema[], collapsed = true): Schema {
    return Schema.intersect(children).description(title).collapse(collapsed).role("yib-section");
}

export const Config: Schema<Config> = Schema.intersect([
    Schema.object({ version: Schema.union([Schema.string(), Schema.number()]).hidden() }),
    section("模型服务", [subgroup("提供商与模型", ["providers"]), subgroup("模型组", ["modelGroups"]), subgroup("任务分配", ["task"])], false),
    section("人格与提示词", [
        subgroup("核心记忆文件", ["coreMemoryPath"]),
        subgroup("提示词模板", ["systemTemplate", "userTemplate", "multiModalSystemTemplate"]),
        subgroup("模板渲染（高级）", ["injectionPlaceholder", "maxRenderDepth"]),
    ]),
    section(
        "回复触发与意愿",
        [
            subgroup("响应范围", ["allowedChannels"]),
            subgroup("直接触发", ["prioritizeMentions"]),
            take(["willingnessPolicy"]),
            subgroup("基础增益", ["base", "attribute", "interest"]),
            take(["lifecycle", "participation", "topics", "typesafe", "continuation", "replySuppression"]),
        ],
        false,
    ),
    section("消息处理与工具", [
        subgroup("消息调度", ["debounceMs", "newMessageStrategy", "deferredProcessingTime", "heartbeat"]),
        subgroup("工具调用方式", ["nativeToolCalling", "streamAction"]),
        take(["backgroundTools"]),
        subgroup("扩展启用", ["extra"]),
        take(["advanced"]),
    ]),
    section("上下文与记忆", [
        subgroup("输入预算", ["contextInputBudgetTokens"]),
        subgroup("图片上下文", ["enableVision", "allowedImageTypes", "maxImagesInContext", "imageLifecycleCount", "detail"]),
        take(["l1_memory", "l2_memory", "l3_memory"]),
        subgroup("历史保留与清理", ["ignoreSelfMessage", "logLengthLimit", "dataRetentionDays", "cleanupIntervalSec"]),
    ]),
    section("资源处理", [
        subgroup("资源存储", ["storagePath", "driver", "assetEndpoint"]),
        subgroup("处理限制", ["maxFileSize", "downloadTimeout", "recoveryEnabled"]),
        take(["autoClear", "image"]),
    ]),
    section("日志、诊断与上报", [take(["logging", "decisionRecording", "errorReporting"])]),
]);

if (fields.size) throw new TypeError(`Configuration fields missing navigation: ${[...fields.keys()].join(", ")}`);
