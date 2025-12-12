import type { ChatModelInfo, CommonRequestOptions, EmbedModelInfo, SharedProvider } from "@yesimbot/shared-model";
import type { Context } from "koishi";
import { ChatModelAbility } from "@yesimbot/shared-model";
import { Schema, Service } from "koishi";
import { Services } from "@/shared/constants";

export interface ModelGroup {
    name: string;
    models: string[];
}

export interface RegistryConfig {
    separator?: string;
    groups?: ModelGroup[];
}

export const RegistryConfig: Schema<RegistryConfig> = Schema.object({
    separator: Schema.string().default(">").description("用于分隔提供者名称和模型名称的分隔符。"),
    groups: Schema.array(
        Schema.object({
            name: Schema.string().required().description("模型组名称。"),
            models: Schema.array(Schema.string()).required().description("模型名称列表。"),
        }),
    ).description("模型分组配置。"),
}).description("提供者注册表配置。");

declare module "koishi" {
    interface Context {
        [Services.ProviderRegistry]: ProviderRegistry;
    }
}

export class ProviderRegistry extends Service<any> {
    public readonly registryConfig: RegistryConfig;

    private readonly providers: Map<string, SharedProvider> = new Map();
    private readonly chatModelInfos: Map<string, ChatModelInfo> = new Map();
    private readonly embedModelInfos: Map<string, EmbedModelInfo> = new Map();

    constructor(ctx: Context, config: any) {
        super(ctx, Services.ProviderRegistry, true);

        const resolved: RegistryConfig
            = config && typeof config === "object" && ("separator" in config || "groups" in config)
                ? (config as RegistryConfig)
                : (config?.providerRegistry ?? {});

        const separator = resolved.separator ?? ">";

        const legacyGroups: ModelGroup[] | undefined = Array.isArray(config?.modelGroups)
            ? config.modelGroups
                    .filter((g: any) => g && typeof g.name === "string" && Array.isArray(g.models))
                    .map((g: any) => ({
                        name: g.name,
                        models: g.models
                            .map((m: any) => {
                                if (typeof m === "string")
                                    return m;
                                const providerName = String(m?.providerName ?? "").trim();
                                const modelId = String(m?.modelId ?? "").trim();
                                if (!providerName || !modelId)
                                    return "";
                                return `${providerName}${separator}${modelId}`;
                            })
                            .filter((s: string) => s.length > 0),
                    }))
            : undefined;

        this.registryConfig = {
            separator,
            groups: (resolved.groups && resolved.groups.length > 0)
                ? resolved.groups
                : (legacyGroups ?? []),
        };

        this.refreshSchemas();
    }

    private parseFullName(fullName: string): { providerName: string; modelName: string } | null {
        const separator
            = this.registryConfig.separator && this.registryConfig.separator.length > 0
                ? this.registryConfig.separator
                : ">";
        const index = fullName.indexOf(separator);
        if (index <= 0)
            return null;

        const providerName = fullName.slice(0, index).trim();
        const modelName = fullName.slice(index + separator.length).trim();

        if (!providerName || !modelName)
            return null;

        return { providerName, modelName };
    }

    private formatFullName(providerName: string, modelName: string): string {
        const separator
            = this.registryConfig.separator && this.registryConfig.separator.length > 0
                ? this.registryConfig.separator
                : ">";
        return `${providerName}${separator}${modelName}`;
    }

    public getChatModelInfo(fullName: string): ChatModelInfo | undefined {
        return this.chatModelInfos.get(fullName);
    }

    public isVisionChatModel(fullName: string): boolean {
        const info = this.getChatModelInfo(fullName);
        return Boolean((info?.abilities ?? []).includes(ChatModelAbility.ImageInput));
    }

    public resolveChatModels(nameOrGroup: string): string[] {
        const group = (this.registryConfig.groups ?? []).find((g) => g.name === nameOrGroup);
        if (group)
            return group.models;
        return [nameOrGroup];
    }

    private createUnion(options: Schema[], fallback: Schema): Schema {
        if (!options.length)
            return fallback;
        return Schema.union(options);
    }

    private refreshSchemas(): void {
        // Chat models
        const chatOptions = Array.from(this.chatModelInfos.values()).map((m) =>
            Schema.const(this.formatFullName(m.providerName, m.modelId)).description(
                `${m.providerName} - ${m.modelId}`,
            ),
        );

        const chatVisionOptions = Array.from(this.chatModelInfos.values())
            .filter((m) => (m.abilities ?? []).includes(ChatModelAbility.ImageInput))
            .map((m) =>
                Schema.const(this.formatFullName(m.providerName, m.modelId)).description(
                    `${m.providerName} - ${m.modelId}`,
                ),
            );

        const embedOptions = Array.from(this.embedModelInfos.values()).map((m) =>
            Schema.const(this.formatFullName(m.providerName, m.modelId)).description(
                `${m.providerName} - ${m.modelId}`,
            ),
        );

        const customModel = Schema.string().description("自定义模型 (例如 openai>gpt-4o)");

        this.ctx.schema.set("providerRegistry.chatModels", this.createUnion(chatOptions, customModel).default(""));

        this.ctx.schema.set(
            "providerRegistry.chatVisionModels",
            this.createUnion(chatVisionOptions, customModel).default(""),
        );

        this.ctx.schema.set("providerRegistry.embedModels", this.createUnion(embedOptions, customModel).default(""));

        // Groups
        const groupNames = (this.registryConfig.groups ?? []).map((g) => g.name);
        const groupOptions = groupNames.map((name) => Schema.const(name).description(name));
        const customGroup = Schema.string().description("自定义模型组");

        this.ctx.schema.set(
            "providerRegistry.availableGroups",
            this.createUnion(groupOptions, customGroup).default(groupNames[0] ?? ""),
        );

        // Mixed: group or chat model
        const groupOrModelOptions = [
            ...groupNames.map((name) => Schema.const(name).description(`模型组 - ${name}`)),
            ...chatOptions,
        ];

        this.ctx.schema.set(
            "providerRegistry.chatModelOrGroup",
            this.createUnion(groupOrModelOptions, Schema.string().description("模型/模型组")).default(""),
        );
    }

    /** Register a provider implementation for request options generation. */
    public setProvider(name: string, provider: SharedProvider): void {
        if (this.providers.has(name)) {
            throw new Error(`Provider with name "${name}" is already registered.`);
        }
        this.providers.set(name, provider);
    }

    /** Register chat model metadata used for schema filtering (e.g. vision-capable). */
    public addChatModels(providerName: string, models: Array<Omit<ChatModelInfo, "providerName">>): void {
        for (const model of models) {
            const info: ChatModelInfo = { ...model, providerName, modelType: model.modelType } as ChatModelInfo;
            this.chatModelInfos.set(this.formatFullName(providerName, model.modelId), info);
        }
        this.refreshSchemas();
    }

    /** Register embedding model metadata used for schema listing. */
    public addEmbedModels(providerName: string, models: Array<Omit<EmbedModelInfo, "providerName">>): void {
        for (const model of models) {
            const info: EmbedModelInfo = { ...model, providerName, modelType: model.modelType } as EmbedModelInfo;
            this.embedModelInfos.set(this.formatFullName(providerName, model.modelId), info);
        }
        this.refreshSchemas();
    }

    /** Replace model group config and refresh schemas. */
    public setGroups(groups: ModelGroup[]): void {
        this.registryConfig.groups = groups;
        this.refreshSchemas();
    }

    // Backward-compatible placeholder (was planned as internal helper).
    private addModelToSchema() {
        this.refreshSchemas();
    }

    public getChatModel(fullName: string): CommonRequestOptions | undefined {
        const parsed = this.parseFullName(fullName);
        if (!parsed)
            return undefined;

        const provider = this.providers.get(parsed.providerName);
        if (provider && provider.chat) {
            return provider.chat(parsed.modelName);
        }
    }

    public getEmbedModel(fullName: string): CommonRequestOptions | undefined {
        const parsed = this.parseFullName(fullName);
        if (!parsed)
            return undefined;

        const provider = this.providers.get(parsed.providerName);
        if (provider && provider.embed) {
            return provider.embed(parsed.modelName);
        }
    }
}
