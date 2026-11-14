import type { Config } from "../config";

type ReferenceIssue = { path: string; message: string; signature: string; detail?: string };

export function isModelReference(value: unknown): value is { providerName: string; modelId: string } {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const ref = value as Record<string, unknown>;
    return typeof ref.providerName === "string" && !!ref.providerName.trim() && typeof ref.modelId === "string" && !!ref.modelId.trim();
}

export function findBrokenModelReferences(config: Config): ReferenceIssue[] {
    const providers = config.providers ?? [];
    const groups = config.modelGroups ?? [];
    const issues: ReferenceIssue[] = [];
    const add = (path: string, message: string, ref: unknown) => {
        const detail = isModelReference(ref) ? `${ref.providerName} / ${ref.modelId}` : typeof ref === "string" ? ref : undefined;
        issues.push({ path, message, signature: JSON.stringify([path, message, detail]), detail });
    };
    const check = (path: string, ref: unknown, optional = false) => {
        if (optional && (!ref || (typeof ref === "object" && "providerName" in ref && !ref.providerName && "modelId" in ref && !ref.modelId))) return;
        if (!isModelReference(ref)) {
            add(path, "缺少有效的提供商名称或模型 ID", ref);
            return;
        }
        const provider = providers.find((item) => item?.name === ref.providerName);
        if (!provider) add(path, "引用的提供商不存在", ref);
        else if (!provider.models?.some((model) => model?.modelId === ref.modelId)) add(path, "引用的模型不存在", ref);
    };
    for (const [i, group] of groups.entries()) {
        const path = `modelGroups[${i}]`;
        if (!group || typeof group.name !== "string" || !group.name.trim() || !Array.isArray(group.models) || !group.models.length) {
            add(path, "模型组缺少名称或有效模型列表", group?.name);
            continue;
        }
        for (const [j, ref] of group.models.entries()) check(`${path}.models[${j}]`, ref);
    }
    for (const [task, name] of Object.entries(config.task ?? {})) {
        if (name && !groups.some((group) => group?.name === name)) add(`task.${task}`, "引用的模型组不存在", name);
    }
    check("topics.model", config.topics?.model, true);
    check("typesafe.evaluationModel", config.typesafe?.evaluationModel, true);
    check("extra.core_util.vision.model", config.extra?.core_util?.vision?.model, true);
    return issues;
}

/** A local configuration check. Never include credentials or endpoint URLs. */
export function checkConfiguration(config: Config): string {
    const providers = config.providers ?? [],
        groups = config.modelGroups ?? [];
    const issues: string[] = [];
    const duplicateNames = (entries: Array<{ name: string }>, label: string) => {
        const seen = new Set<string>();
        for (const entry of entries) {
            if (!entry || typeof entry.name !== "string") continue;
            if (seen.has(entry.name)) issues.push(`${label}名称重复：${entry.name}；请使用不同名称。`);
            seen.add(entry.name);
        }
    };
    duplicateNames(providers, "提供商");
    duplicateNames(groups, "模型组");
    if (!providers.length) issues.push("尚未配置模型提供商，请先添加提供商和对话模型。");
    issues.push(...findBrokenModelReferences(config).map(({ path, message, detail }) => `${path} ${message}${detail ? ` ${detail}` : ""}。`));
    const tasks = config.task ?? {};
    if (!tasks.chat) issues.push("未指定对话模型组，请为 chat 选择模型组。");
    const embedding = groups.find((group) => group?.name === tasks.embed);
    if (config.l2_memory?.enabled && !embedding) issues.push("未分配嵌入模型组；语义检索不可用，关键词召回仍可使用。请为 embed 分配支持嵌入的模型组。");
    if (
        embedding &&
        !embedding.models?.some(
            (ref) =>
                isModelReference(ref) &&
                providers.find((p) => p?.name === ref.providerName)?.models?.some((m) => m?.modelId === ref.modelId && m.abilities?.includes("嵌入" as any)),
        )
    )
        issues.push(`嵌入模型组 ${embedding.name} 没有声明嵌入能力的模型，请检查能力勾选及提供商支持。`);
    const capabilities = providers.flatMap((provider) =>
        (provider?.models ?? [])
            .filter(Boolean)
            .map(
                (model) =>
                    `${provider.name} / ${model.modelId}：${(model.abilities ?? []).join("、") || "未声明能力"}${model.disableNativeToolCalling ? "；原生工具已关闭，使用 JSON 动作" : ""}`,
            ),
    );
    return [
        "配置检查（本地检查，不会发起模型请求）",
        issues.length ? issues.map((issue) => `• ${issue}`).join("\n") : "未发现模型引用或任务分配错误。",
        "模型能力声明（是否实际可用需以提供商响应为准）：",
        ...capabilities,
        "网络搜索能力标记不会自动启用提供商原生联网。",
    ].join("\n");
}
