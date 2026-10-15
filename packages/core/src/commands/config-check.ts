import type { Config } from "../config";

/** A local configuration check. Never include credentials or endpoint URLs. */
export function checkConfiguration(config: Config): string {
    const providers = config.providers ?? [],
        groups = config.modelGroups ?? [];
    const issues: string[] = [];
    const duplicateNames = (entries: Array<{ name: string }>, label: string) => {
        const seen = new Set<string>();
        for (const entry of entries) {
            if (seen.has(entry.name)) issues.push(`${label}名称重复：${entry.name}；请使用不同名称。`);
            seen.add(entry.name);
        }
    };
    duplicateNames(providers, "提供商");
    duplicateNames(groups, "模型组");
    if (!providers.length) issues.push("尚未配置模型提供商，请先添加提供商和对话模型。");
    for (const group of groups) {
        if (!group.models.length) issues.push(`模型组 ${group.name} 为空，请至少添加一个模型。`);
        for (const ref of group.models) {
            const provider = providers.find((item) => item.name === ref.providerName);
            if (!provider) issues.push(`模型组 ${group.name} 引用了不存在的提供商 ${ref.providerName}。`);
            else if (!provider.models.some((model) => model.modelId === ref.modelId))
                issues.push(`模型组 ${group.name} 引用了不存在的模型 ${ref.providerName} / ${ref.modelId}。`);
        }
    }
    const tasks = config.task ?? {};
    for (const [task, name] of Object.entries(tasks)) {
        if (name && !groups.some((group) => group.name === name)) issues.push(`任务 ${task} 指定的模型组 ${name} 不存在。`);
    }
    if (!tasks.chat) issues.push("未指定对话模型组，请为 chat 选择模型组。");
    const embedding = groups.find((group) => group.name === tasks.embed);
    if (config.l2_memory?.enabled && !embedding) issues.push("未分配嵌入模型组；语义检索不可用，关键词召回仍可使用。请为 embed 分配支持嵌入的模型组。");
    if (
        embedding &&
        !embedding.models.some((ref) =>
            providers.find((p) => p.name === ref.providerName)?.models.some((m) => m.modelId === ref.modelId && m.abilities.includes("嵌入" as any)),
        )
    )
        issues.push(`嵌入模型组 ${embedding.name} 没有声明嵌入能力的模型，请检查能力勾选及提供商支持。`);
    const capabilities = providers.flatMap((provider) =>
        provider.models.map(
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
