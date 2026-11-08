/** Presentation-only views over the unchanged, serialized runtime schema. */
export interface FormSchema {
    type: string;
    meta: Record<string, any>;
    dict?: Record<string, FormSchema>;
    list?: FormSchema[];
    [key: string]: any;
}
export interface ConfigEntry {
    path: string[];
    schema: FormSchema;
    omit?: string[];
}
export interface ConfigGroup {
    id: string;
    label: string;
    entries: ConfigEntry[];
    note?: string;
}
export interface ConfigCategory {
    id: string;
    label: string;
    groups: ConfigGroup[];
}

// An intersect groups fields at the same runtime path; array members and nested
// object properties belong to their original native editor and are not flattened.
export function collectConfigFields(schema: FormSchema): Record<string, FormSchema> {
    const fields: Record<string, FormSchema> = {};
    const visit = (node: FormSchema) => {
        if (!node || node.meta?.hidden) return;
        if (node.type === "object") {
            for (const [key, field] of Object.entries(node.dict ?? {})) {
                if (!fields[key] || (fields[key].meta?.hidden && !field.meta?.hidden)) fields[key] = field;
            }
        } else if (node.type === "intersect" || node.type === "union") {
            for (const child of node.list ?? []) visit(child);
        }
    };
    visit(schema);
    return fields;
}

type CategoryDefinition = [string, string, Array<[string, string, string[]]>];
const definitions: CategoryDefinition[] = [
    [
        "models",
        "模型与连接",
        [
            ["providers", "模型提供商", ["providers"]],
            ["model-groups", "模型组与任务分配", ["modelGroups", "task"]],
        ],
    ],
    [
        "reply",
        "对话与回复",
        [
            ["scope", "响应范围与唤醒", ["allowedChannels", "prioritizeMentions", "debounceMs"]],
            ["new-messages", "新消息处理与回复暂停", ["newMessageStrategy", "deferredProcessingTime", "replySuppression"]],
            ["willingness", "基础意愿与回复概率", ["base", "attribute", "interest", "lifecycle"]],
            ["participation", "对话参与保持", ["participation"]],
            ["continuation", "等待后续消息", ["continuation"]],
            ["typesafe", "TypeSafe 接话判断", ["typesafe"]],
            ["topics", "话题意愿", ["topics"]],
            ["typing", "发送节奏与送达超时", []],
        ],
    ],
    [
        "memory",
        "记忆与上下文",
        [
            ["context", "本轮上下文", ["ignoreSelfMessage", "contextInputBudgetTokens"]],
            ["l1", "近期对话与完整轮次", ["l1_memory"]],
            ["core-memory", "核心记忆文件", ["coreMemoryPath"]],
            ["l2", "语义记忆检索", ["l2_memory"]],
            ["l3", "长期日记", ["l3_memory"]],
        ],
    ],
    [
        "vision",
        "视觉与图片",
        [
            [
                "vision-input",
                "视觉开关与附图规则",
                [
                    "enableVision",
                    "allowedImageTypes",
                    "maxImagesInContext",
                    "imageLifecycleCount",
                    "imageFollowUpWindowSeconds",
                    "imageFollowUpMaxTurns",
                    "detail",
                ],
            ],
            ["vision-auxiliary", "辅助识图模型与超时", []],
            ["image-processing", "图片压缩与动图处理", ["image"]],
            ["vision-prompt", "图片占位符说明", ["multiModalSystemTemplate"]],
        ],
    ],
    [
        "persona",
        "角色与提示词",
        [
            ["templates", "角色与对话模板", ["systemTemplate", "userTemplate"]],
            ["rendering", "模板渲染选项", ["injectionPlaceholder", "maxRenderDepth"]],
        ],
    ],
    [
        "tools",
        "工具与任务",
        [
            ["execution", "工具调用与单轮执行", ["nativeToolCalling", "nativeToolCorrectionRetries", "streamAction", "heartbeat"]],
            ["background", "后台任务", ["backgroundTools"]],
            ["tool-policy", "工具超时与重试", ["advanced"]],
            ["extensions", "扩展工具开关与设置", ["extra"]],
        ],
    ],
    [
        "maintenance",
        "存储与维护",
        [
            ["storage", "文件存储与下载", ["storagePath", "driver", "assetEndpoint", "maxFileSize", "downloadTimeout", "recoveryEnabled"]],
            ["asset-cleanup", "资源自动清理", ["autoClear"]],
            ["history-cleanup", "历史保留与清理", ["logLengthLimit", "dataRetentionDays", "cleanupIntervalSec"]],
            ["logging", "日志", ["logging"]],
            ["errors", "错误上报", ["errorReporting"]],
            ["decisions", "决策记录与回放", ["decisionRecording"]],
            ["other", "其他设置", []],
        ],
    ],
];

const projectedCoreFields = ["vision", "typing", "deliveryTimeoutMs"];

// Clone only schema structure, never mutate the live console registry or change
// defaults in the server validator. Omit both union branches, including hidden
// disabled-state fields, so the original location has no second editing source.
function omitSchemaFields(schema: FormSchema, omitted: string[]): FormSchema {
    const meta = { ...schema.meta };
    if (meta.default && typeof meta.default === "object" && !Array.isArray(meta.default)) {
        meta.default = Object.fromEntries(Object.entries(meta.default).filter(([key]) => !omitted.includes(key)));
    }
    return {
        ...schema,
        meta,
        ...(schema.dict ? { dict: Object.fromEntries(Object.entries(schema.dict).filter(([key]) => !omitted.includes(key))) } : {}),
        ...(schema.list ? { list: schema.list.map((child) => omitSchemaFields(child, omitted)) } : {}),
    };
}

export function createConfigLayout(schema: FormSchema, dynamicSchemas: Record<string, FormSchema> = {}, config: any = {}): ConfigCategory[] {
    const fields = collectConfigFields(schema);
    const used = new Set<string>();
    const categories: ConfigCategory[] = definitions.map(([id, label, groups]) => ({
        id,
        label,
        groups: groups.map(([id, label, names]) => ({
            id,
            label,
            entries: names.flatMap((name) => {
                const field = fields[name];
                if (!field || field.meta?.hidden || used.has(name)) return [];
                used.add(name);
                return [{ path: [name], schema: field }];
            }),
        })),
    }));
    const group = (id: string) => categories.flatMap((category) => category.groups).find((group) => group.id === id)!;
    const registry = dynamicSchemas["toolService.availableExtensions"];
    if (registry) {
        const extensions = collectConfigFields(registry);
        const extensionGroup = group("extensions");
        extensionGroup.entries = [];
        for (const [name, extensionSchema] of Object.entries(extensions)) {
            if (extensionSchema.meta?.hidden) continue;
            if (name !== "core_util") {
                extensionGroup.entries.push({ path: ["extra", name], schema: extensionSchema });
                continue;
            }
            const coreFields = collectConfigFields(extensionSchema);
            const moved = projectedCoreFields.filter((name) => coreFields[name] && !coreFields[name].meta?.hidden);
            extensionGroup.entries.push({ path: ["extra", name], schema: omitSchemaFields(extensionSchema, moved), omit: moved });
            if (config?.extra?.core_util?.enabled === false) {
                group("vision-auxiliary").note = "核心工具集已关闭。启用“工具与任务”中的核心工具集后，可设置辅助识图。";
                group("typing").note = "核心工具集已关闭。启用后可设置发送节奏与送达超时。";
                continue;
            }
            for (const key of moved) {
                group(key === "vision" ? "vision-auxiliary" : "typing").entries.push({ path: ["extra", name, key], schema: coreFields[key] });
            }
        }
    }
    const fallback = group("other");
    for (const [name, field] of Object.entries(fields)) {
        if (!used.has(name) && !field.meta?.hidden) fallback.entries.push({ path: [name], schema: field });
    }
    return categories.map((category) => ({ ...category, groups: category.groups.filter((group) => group.entries.length || group.note) }));
}

export function readConfigEntry(config: any, entry: ConfigEntry): any {
    const value = entry.path.reduce((value, key) => value?.[key], config);
    if (!entry.omit || value == null) return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !entry.omit!.includes(key)));
}

export function writeConfigEntry(config: any, entry: ConfigEntry, value: any): any {
    const update = (current: any, index: number): any => {
        const key = entry.path[index];
        const next = { ...current };
        if (index < entry.path.length - 1) next[key] = update(current?.[key], index + 1);
        else {
            const preserved = entry.omit ? Object.fromEntries(Object.entries(current?.[key] ?? {}).filter(([key]) => entry.omit!.includes(key))) : {};
            if (value == null && !Object.keys(preserved).length) delete next[key];
            else next[key] = entry.omit ? { ...value, ...preserved } : value;
        }
        return next;
    };
    return update(config, 0);
}
