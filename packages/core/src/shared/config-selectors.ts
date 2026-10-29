import { Schema } from "koishi";

/** Static controls remain editable before the instance registers its live choices. */
export function modelSelector(name: string, required = false): Schema {
    return Schema.union([
        Schema.object({
            providerName: Schema.string().required(required).description("提供商名称"),
            modelId: Schema.string().required(required).description("模型 ID"),
        }).required(),
        Schema.const(undefined).hidden(),
    ]).role("yib-dynamic", { name });
}
export function groupSelector(): Schema {
    return Schema.string().role("yib-dynamic", { name: "modelService.availableGroups" });
}
export function backgroundToolSelector(): Schema {
    return Schema.array(Schema.string()).role("yib-dynamic", { name: "toolService.backgroundEligibleTools" });
}
export function extensionSelector(): Schema {
    return Schema.dict(Schema.object({ enabled: Schema.boolean().description("启用此扩展") }))
        .role("yib-dynamic", { name: "toolService.availableExtensions" })
        .description("扩展配置（扩展加载后显示完整选项）");
}
