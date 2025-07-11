import { stringify, truncate } from "@/shared/utils";
import { Context, ForkScope, Logger, Schema, Service, Session } from "koishi";
import { Services } from "../types";
import CommandExtension from "./builtin/command";
import CoreUtilExtension from "./builtin/core-util";
import CreatorExtension from "./builtin/creator";
import InteractionsExtension from "./builtin/interactions";
import MemoryExtension from "./builtin/memory";
import QManagerExtension from "./builtin/qmanager";
import SearchExtension from "./builtin/search";
import { ToolServiceConfig } from "./config";
import { extractMetaFromSchema, Failed } from "./helpers";
import { IExtension, ToolCallResult, ToolDefinition, ToolSchema } from "./types";

declare module "koishi" {
    interface Context {
        [Services.Tool]: ToolService;
    }
}

/**
 * ToolService
 * 负责注册、管理和提供所有扩展和工具。
 */
export class ToolService extends Service<ToolServiceConfig> {
    static readonly inject = [Services.Logger];
    private tools: Map<string, ToolDefinition> = new Map();
    private extensions: Map<string, IExtension> = new Map();

    private _logger: Logger;

    constructor(ctx: Context, config: ToolServiceConfig) {
        super(ctx, Services.Tool, true);
        this.config = config;
        this._logger = ctx[Services.Logger].getLogger("[工具管理器]");
    }

    protected async start() {
        const builtinExtensions = [
            CoreUtilExtension,
            CommandExtension,
            CreatorExtension,
            MemoryExtension,
            QManagerExtension,
            SearchExtension,
            InteractionsExtension,
        ];
        const loadedExtensions = new Map<string, ForkScope>();

        for (const Ext of builtinExtensions) {
            //@ts-ignore
            // 不能在这里判断是否启用，否则无法生成配置
            const name = Ext.prototype.metadata.name;
            const config = this.config.extra[name];
            // if (config && !config.enabled) {
            //     this._logger.info(`跳过内置扩展: ${name}`);
            //     continue;
            // }
            loadedExtensions.set(name, this.ctx.plugin(Ext, config));
        }
        this._logger.info("服务已启动");
    }

    /**
     * 注册一个新的扩展。
     * @param ExtConstructor 扩展的构造函数
     * @param enabled 是否启用此扩展
     * @param extConfig 传递给扩展实例的配置
     */
    public register(extensionInstance: IExtension, enabled: boolean, extConfig: any) {
        const validate: Schema<any> = extensionInstance.constructor["Config"];
        const validatedConfig = validate ? validate(extConfig) : extConfig;

        let availableExtensions = this.ctx.schema.get("toolService.availableExtensions");

        if (availableExtensions.type !== "object") {
            availableExtensions = Schema.object({});
        }

        try {
            if (!extensionInstance.metadata || !extensionInstance.metadata.name) {
                this._logger.warn("一个扩展在注册时缺少元数据或名称，已跳过。");
                return;
            }

            const metadata = extensionInstance.metadata;

            this.ctx.schema.set(
                "toolService.availableExtensions",
                availableExtensions.set(
                    extensionInstance.metadata.name,
                    Schema.object({
                        enabled: Schema.boolean().default(true).description("是否启用此扩展"),
                        config: validate && enabled ? validate.default(validatedConfig) : Schema.object({}),
                    }).description(`${metadata.display || metadata.name} - ${metadata.description}`)
                )
            );

            if (!enabled) {
                this._logger.info(`扩展 "${metadata.name}" 已禁用。`);
                return;
            }

            this._logger.info(`正在注册扩展: "${extensionInstance.metadata.name}"`);
            this.extensions.set(extensionInstance.metadata.name, extensionInstance);

            if (extensionInstance.tools) {
                for (const [name, tool] of extensionInstance.tools.entries()) {
                    this._logger.debug(`  -> 注册工具: "${tool.name}"`);
                    this.tools.set(name, tool);
                }
            }

            this._logger.debug(`扩展 "${metadata.name}" 已加载。`);
        } catch (error) {
            this._logger.error(`扩展配置验证失败: ${error.message}`);
            return;
        }
    }

    public unregister(name: string): boolean {
        const ext = this.extensions.get(name);
        if (!ext) {
            this._logger.warn(`尝试卸载不存在的扩展: "${name}"`);
            return false;
        }
        this.extensions.delete(name);
        for (const tool of ext.tools.values()) {
            this.tools.delete(tool.name);
        }
        this._logger.info(`已卸载扩展: "${name}"`);
        return true;
    }

    public registerTool(definition: ToolDefinition) {
        this.tools.set(definition.name, definition);
    }

    public unregisterTool(name: string) {
        this.tools.delete(name);
    }

    public async invoke(functionName: string, params: Record<string, unknown>, session?: Session): Promise<ToolCallResult> {
        const tool = this.getTool(functionName);
        if (!tool) {
            this._logger.warn(`[执行] 工具未找到 | 名称: ${functionName}`);
            return Failed(`Tool ${functionName} not found`);
        }

        const stringifyParams = truncate(stringify(params), 100);
        this._logger.info(`[执行] → 调用: ${functionName} | 参数: ${stringifyParams}`);
        let lastResult: ToolCallResult = Failed("Tool call did not execute.");

        for (let attempt = 1; attempt <= this.config.advanced.maxRetry + 1; attempt++) {
            try {
                if (attempt > 1) {
                    this._logger.info(`  - [执行] 重试 (${attempt - 1}/${this.config.advanced.maxRetry})`);
                    await new Promise((resolve) => setTimeout(resolve, this.config.advanced.retryDelayMs));
                }

                lastResult = (await tool.execute({ session, ...params })) || Failed("Tool call did not execute.");
                const resultString = truncate(stringify(lastResult), 120);

                if (lastResult.status === "success") {
                    this._logger.success(`[执行] ✔ 成功 ← 返回: ${resultString}`);
                    return lastResult;
                }
                if (!lastResult.retryable) {
                    this._logger.warn(`[执行] ✖ 失败 (不可重试) ← 原因: ${lastResult.error}`);
                    return lastResult;
                }
                this._logger.warn(`[执行] ⚠ 失败 (可重试) ← 原因: ${lastResult.error}`);
            } catch (error) {
                this._logger.error(`[执行] 💥 异常 | 调用 ${functionName} 时出错`, error.message);
                this._logger.debug(error.stack);
                lastResult = Failed(`Exception: ${error.message}`);
                return lastResult;
            }
        }
        this._logger.error(`[执行] ✖ 失败 (耗尽重试) | 工具: ${functionName}`);
        return lastResult;
    }

    public getTool(name: string, session?: Session): ToolDefinition | undefined {
        const tool = this.tools.get(name);
        if (!tool || (tool.isSupported && !tool.isSupported(session))) {
            return undefined;
        }
        return tool;
    }

    public getAvailableTools(session: Session) {
        return Array.from(this.tools.values()).filter((tool) => !tool.isSupported || tool.isSupported(session));
    }

    public getExtension(name: string): IExtension | undefined {
        return this.extensions.get(name);
    }

    public getSchema(name: string): ToolSchema {
        const tool = this.tools.get(name);
        if (!tool) {
            return undefined;
        }
        return {
            name: tool.name,
            description: tool.description,
            parameters: extractMetaFromSchema(tool.parameters),
        };
    }

    getToolSchemas(): ToolSchema[] {
        return Array.from(this.tools.values()).map((tool) => this.getSchema(tool.name));
    }
}
