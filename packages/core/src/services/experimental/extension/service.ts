// --- 服务与管理 ---

import { Context, Schema, Service, Session } from "koishi";
import { ToolServiceConfig } from "./config";
import { IExtension, ToolDefinition } from "./types";

type ExtensionConstructor = new (ctx: Context, config: any) => IExtension;

declare module "koishi" {
    interface Context {
        tool: ToolService;
    }
}

/**
 * ToolService
 * 负责注册、管理和提供所有扩展和工具。
 */
export class ToolService extends Service<ToolServiceConfig> {
    private tools: Map<string, ToolDefinition> = new Map();
    private extensions: Map<string, IExtension> = new Map();

    constructor(ctx: Context, config: ToolServiceConfig) {
        super(ctx, "tool");
    }

    protected async start() {
        this.ctx.logger.info("服务已启动");
    }

    /**
     * 注册一个新的扩展。
     * @param ExtConstructor 扩展的构造函数
     * @param extConfig 传递给扩展实例的配置
     */
    public register(ExtConstructor: ExtensionConstructor, extConfig: any) {
        const validate: Schema<any> = ExtConstructor.prototype.constructor.Config;

        try {
            if (!validate) {
                this.ctx.logger.warn(`[ToolManager] 扩展 ${ExtConstructor.name} 未定义配置模式。`);
            }
            const validatedConfig = validate?.(extConfig);

            const instance = new ExtConstructor(this.ctx, validatedConfig);

            if (!instance.metadata || !instance.metadata.name) {
                this.ctx.logger.warn("一个扩展在注册时缺少元数据或名称，已跳过。");
                return;
            }

            this.ctx.logger.info(`[ToolManager] 正在注册扩展: "${instance.metadata.name}"`);
            this.extensions.set(instance.metadata.name, instance);

            if (instance.tools) {
                for (const [name, tool] of instance.tools.entries()) {
                    this.ctx.logger.debug(`  -> 注册工具: "${tool.name}"`);
                    this.tools.set(name, tool);
                }
            }

            let availableExtensions = this.ctx.schema.get("toolService.availableExtensions");

            if (availableExtensions.type !== "object") {
                availableExtensions = Schema.object({});
            }

            this.ctx.schema.set(
                "toolService.availableExtensions",
                availableExtensions.set(
                    instance.metadata.name,
                    Schema.object({
                        enabled: Schema.boolean().default(true).description("是否启用此扩展"),
                        config: validate ? validate.default(validatedConfig) : undefined,
                    }).description(`${instance.metadata.name} - ${instance.metadata.description}`)
                )
            );
        } catch (error) {
            this.ctx.logger.error(`[ToolManager] 扩展配置验证失败: ${error.message}`);
            return;
        }
    }

    public unregister(name: string): boolean {
        const ext = this.extensions.get(name);
        if (!ext) {
            this.ctx.logger.warn(`[ToolManager] 尝试卸载不存在的扩展: "${name}"`);
            return false;
        }
        this.extensions.delete(name);
        for (const tool of ext.tools.values()) {
            this.tools.delete(tool.name);
        }
        this.ctx.logger.info(`[ToolManager] 已卸载扩展: "${name}"`);
        return true;
    }

    public getTool(name: string, session?: Session): ToolDefinition | undefined {
        const tool = this.tools.get(name);
        if (!tool || (tool.isSupported && !tool.isSupported(session))) {
            return undefined;
        }
        return tool;
    }

    public getAvailableTools(session: Session){
        return Array.from(this.tools.values()).filter((tool) => !tool.isSupported || tool.isSupported(session));
    }

    public getExtension(name: string): IExtension | undefined {
        return this.extensions.get(name);
    }

    public getSchema(name: string) {
        const tool = this.tools.get(name);
        if (!tool) {
            return undefined;
        }
        return tool.parameters;
    }
}
