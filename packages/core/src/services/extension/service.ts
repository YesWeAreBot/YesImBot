import { Context, ForkScope, h, Logger, resolveConfig, Schema, Service, Session } from "koishi";

import { Config } from "@/config";
import { PromptService } from "@/services/prompt";
import { Services } from "@/shared/constants";
import { isEmpty, stringify, truncate } from "@/shared/utils";
import CommandExtension from "./builtin/command";
import CoreUtilExtension from "./builtin/core-util";
import InteractionsExtension from "./builtin/interactions";
import MemoryExtension from "./builtin/memory";
import QManagerExtension from "./builtin/qmanager";
import { extractMetaFromSchema, Failed } from "./helpers";
import { IExtension, Properties, ToolCallResult, ToolDefinition, ToolSchema } from "./types";

declare module "koishi" {
    interface Context {
        [Services.Tool]: ToolService;
    }
}

/**
 * ToolService
 * 负责注册、管理和提供所有扩展和工具。
 */
export class ToolService extends Service<Config> {
    static readonly inject = [Services.Prompt];
    private tools: Map<string, ToolDefinition> = new Map();
    private extensions: Map<string, IExtension> = new Map();

    private promptService: PromptService;

    constructor(ctx: Context, config: Config) {
        super(ctx, Services.Tool, true);
        this.config = config;
        this.promptService = ctx[Services.Prompt];
    }

    protected async start() {
        const builtinExtensions = [CoreUtilExtension, CommandExtension, MemoryExtension, QManagerExtension, InteractionsExtension];
        const loadedExtensions = new Map<string, ForkScope>();

        for (const Ext of builtinExtensions) {
            //@ts-ignore
            // 不能在这里判断是否启用，否则无法生成配置
            const name = Ext.prototype.metadata.name;
            const config = this.config.extra[name];
            // if (config && !config.enabled) {
            //     this.ctx.logger.info(`跳过内置扩展: ${name}`);
            //     continue;
            // }
            //@ts-ignore
            loadedExtensions.set(name, this.ctx.plugin(Ext, config));
        }
        this._registerPromptTemplates();
        this.registerCommands();
        //this.ctx.logger.info("服务已启动");
    }

    private registerCommands() {
        this.ctx.command("tool", "工具管理指令集");

        this.ctx
            .command("tool.list", "列出所有可用工具", { authority: 3 })
            .option("filter", "-f <keyword:string> 按名称或描述过滤工具")
            .option("page", "--page <page:natural> 指定显示的页码 (默认为 1)", { fallback: 1 })
            .option("size", "--size <size:natural> 指定每页显示的数量 (默认为 10)", { fallback: 5 })
            .usage(`查询并展示当前所有已加载且可用的工具。\n支持通过关键词过滤和分页显示，方便在工具数量多时进行查找。`)
            .example(
                [
                    "tool.list                      # 显示第一页的10个工具",
                    `tool.list -f search            # 查找所有名称或描述中包含 "search" 的工具`,
                    "tool.list --page 2 --size 5    # 显示第 2 页，每页 5 个工具",
                    `tool.list -f memory --size 3   # 查找 "memory" 相关工具并每页显示 3 个`,
                ].join("\n")
            )
            .action(async ({ session, options }) => {
                // 1. 获取所有可用工具
                let allTools = this.getAvailableTools(session);

                // 2. 应用过滤器（如果提供了 filter 选项）
                const filterKeyword = options.filter?.toLowerCase();
                if (filterKeyword) {
                    allTools = allTools.filter(
                        (t) => t.name.toLowerCase().includes(filterKeyword) || t.description.toLowerCase().includes(filterKeyword)
                    );
                }

                const totalCount = allTools.length;

                // 3. 处理没有结果的情况
                if (totalCount === 0) {
                    return options.filter ? `没有找到与 "${options.filter}" 匹配的工具。` : "当前没有可用的工具";
                }

                // 4. 计算分页参数
                const { page, size } = options;
                const totalPages = Math.ceil(totalCount / size);

                if (page > totalPages) {
                    return `请求的页码 (${page}) 超出范围。总共有 ${totalPages} 页。`;
                }

                // 5. 获取当前页的数据
                const startIndex = (page - 1) * size;
                const pagedTools = allTools.slice(startIndex, startIndex + size);

                // 6. 格式化输出
                const toolList = pagedTools.map((t) => `- ${t.name}: ${t.description}`).join("\n");

                /* prettier-ignore */
                const header = `发现 ${totalCount} 个${options.filter ? "匹配的" : ""}工具。正在显示第 ${page}/${totalPages} 页：\n`;

                return header + toolList;
            });

        this.ctx
            .command("tool.info <name:string>", "显示工具的详细信息", { authority: 3 })
            .usage("查询并展示指定工具的详细信息，包括名称、描述、参数等")
            .example("tool.info search_web")
            .action(async ({ session }, name) => {
                if (!name) return "未指定要查询的工具名称";

                const renderResult = await this.promptService.render("tool.info", { toolName: name, session: session });

                if (!renderResult) {
                    return `未找到名为 "${name}" 的工具或渲染失败。`;
                }

                return h.escape(renderResult);
            });

        this.ctx
            .command("tool.invoke <name:string> [...params:string]", "调用工具", { authority: 3 })
            .usage(
                [
                    "调用指定的工具并传递参数",
                    '参数格式为 "key=value"，多个参数用空格分隔。',
                    '如果 value 包含空格，请使用引号将其包裹，例如：key="some value',
                ].join("\n")
            )
            .example(["tool.invoke search_web keyword=koishi"].join("\n"))
            .action(async ({ session }, name, ...params) => {
                if (!name) return "错误：未指定要调用的工具名称";

                const parsedParams: Record<string, any> = {};
                try {
                    // 更健壮的参数解析，支持 "key=value" 和 key="value with spaces"
                    const paramString = params?.join(" ") || "";
                    const regex = /(\w+)=("([^"]*)"|'([^']*)'|(\S+))/g;
                    let match;
                    while ((match = regex.exec(paramString)) !== null) {
                        const key = match[1];
                        const value = match[3] ?? match[4] ?? match[5]; // 优先取引号内的内容
                        parsedParams[key] = value;
                    }

                    // 对于无法用正则匹配的简单场景做兼容
                    if (Object.keys(parsedParams).length === 0 && params?.length > 0) {
                        for (const param of params) {
                            const parts = param.split("=", 2);
                            if (parts.length === 2) {
                                parsedParams[parts[0]] = parts[1];
                            }
                        }
                    }
                } catch (error: any) {
                    return `参数解析失败：${error.message}\n请检查您的参数格式是否正确（key=value）。`;
                }

                const result = await this.invoke(name, parsedParams, session);

                if (result.status === "success") {
                    /* prettier-ignore */
                    return `✅ 工具 ${name} 调用成功！\n执行结果：${isEmpty(result.result) ? "无返回值" : stringify(result.result, 2)}`;
                } else {
                    return `❌ 工具 ${name} 调用失败。\n原因：${stringify(result.error)}`;
                }
            });
    }

    private _registerPromptTemplates() {
        const toolInfoTemplate = `# 工具名称: {{tool.name}}
## 描述
{{tool.description}}

## 参数
{{#tool.parameters}}
  - {{key}} ({{type}}){{#required}} **(必需)**{{/required}}
    - 描述: {{description}}
{{#default}}
    - 默认值: {{.}}
{{/default}}
{{#enum.length}}
    - 可选值: {{#enum}}"{{.}}" {{/enum}}
{{/enum.length}}
{{#properties}}
    - 对象属性:
{{#.}}
{{> tool.paramDetail}}
{{/.}}
{{/properties}}
{{#items}}
    - 数组项 (每个项都是一个 '{{type}}'):
{{> tool.paramDetail}}
{{/items}}
{{/tool.parameters}}
{{^tool.parameters}}
此工具无需任何参数。
{{/tool.parameters}}`;

        const paramDetailPartial = `{{indent}}  - {{key}} ({{type}}){{#required}} **(必需)**{{/required}}
{{indent}}    - 描述: {{description}}
{{#default}}
{{indent}}    - 默认值: {{.}}
{{/default}}
{{#enum.length}}
{{indent}}    - 可选值: {{#enum}}"{{.}}" {{/enum}}
{{/enum.length}}
{{#properties}}
{{indent}}    - 对象属性:
{{#.}}
{{> tool.paramDetail}}
{{/.}}
{{/properties}}
{{#items}}
{{indent}}    - 数组项 (每个项都是一个 '{{type}}'):
{{> tool.paramDetail}}
{{/items}}`;

        this.promptService.registerTemplate("tool.info", toolInfoTemplate);
        this.promptService.registerTemplate("tool.paramDetail", paramDetailPartial);

        this.promptService.registerSnippet("tool", (context) => {
            const { toolName, session } = context;
            const tool = this.getSchema(toolName, session);
            if (!tool) return null;

            const processParams = (params: Properties, indent = ""): any[] => {
                return Object.entries(params).map(([key, param]) => {
                    const processedParam: any = { ...param, key, indent };
                    if (param.properties) {
                        processedParam.properties = processParams(param.properties, indent + "    ");
                    }
                    if (param.items) {
                        processedParam.items = [
                            {
                                ...param.items,
                                key: "item",
                                indent: indent + "    ",
                                ...(param.items.properties && {
                                    properties: processParams(param.items.properties, indent + "        "),
                                }),
                            },
                        ];
                    }
                    return processedParam;
                });
            };

            return {
                ...tool,
                parameters: tool.parameters ? processParams(tool.parameters) : [],
            };
        });
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
                this.ctx.logger.warn("一个扩展在注册时缺少元数据或名称，已跳过");
                return;
            }

            const metadata = extensionInstance.metadata;

            if (metadata.builtin) {
                this.ctx.schema.set(
                    "toolService.availableExtensions",
                    availableExtensions.set(
                        extensionInstance.metadata.name,
                        Schema.intersect([
                            Schema.object({
                                enabled: Schema.boolean().default(true).description("是否启用此扩展"),
                            }).description(`${metadata.display || metadata.name} - ${metadata.description}`),
                            Schema.union([
                                Schema.object({
                                    enabled: Schema.const(true),
                                    ...(validate && enabled ? validate.default(validatedConfig) : Schema.object({})).dict,
                                }),
                                Schema.object({}),
                            ]),
                        ])
                    )
                );
            }

            if (!enabled) {
                // this.ctx.logger.info(`扩展 "${metadata.name}" 已禁用`);
                return;
            }

            const display = metadata.display || metadata.name;

            this.ctx.logger.info(`正在注册扩展: "${display}"`);
            this.extensions.set(metadata.name, extensionInstance);

            if (extensionInstance.tools) {
                for (const [name, tool] of extensionInstance.tools.entries()) {
                    this.ctx.logger.debug(`  -> 注册工具: "${tool.name}"`);
                    this.tools.set(name, tool);
                }
            }

            // this.ctx.logger.debug(`扩展 "${metadata.name}" 已加载`);
        } catch (error: any) {
            this.ctx.logger.error(`扩展配置验证失败: ${error.message}`);
            return;
        }
    }

    public unregister(name: string): boolean {
        const ext = this.extensions.get(name);
        if (!ext) {
            this.ctx.logger.warn(`尝试卸载不存在的扩展: "${name}"`);
            return false;
        }
        this.extensions.delete(name);
        try {
            for (const tool of ext.tools.values()) {
                this.tools.delete(tool.name);
            }
            this.ctx.logger.info(`已卸载扩展: "${name}"`);
        } catch (error: any) {
            this.ctx.logger.warn(`卸载扩展 ${name} 时出错：${error.message}`);
        }
        return true;
    }

    public registerTool(definition: ToolDefinition) {
        this.tools.set(definition.name, definition);
    }

    public unregisterTool(name: string) {
        return this.tools.delete(name);
    }

    public async invoke(functionName: string, params: Record<string, unknown>, session?: Session): Promise<ToolCallResult> {
        // 1. 获取工具，这里已经包含了 isSupported 的检查
        const tool = this.getTool(functionName, session);
        if (!tool) {
            this.ctx.logger.warn(`工具未找到或在当前会话中不可用 | 名称: ${functionName}`);
            return Failed(`Tool ${functionName} not found or not supported in this context.`);
        }

        // 2. 参数验证 (新加的优雅方案)
        let validatedParams = params;
        if (tool.parameters) {
            try {
                // Schema 对象本身就是验证函数
                validatedParams = tool.parameters(params);
            } catch (error: any) {
                this.ctx.logger.warn(`✖ 参数验证失败 | 工具: ${functionName} | 错误: ${error.message}`);
                // 将详细的验证错误返回给 AI
                return Failed(`Parameter validation failed: ${error.message}`); // 参数错误不可重试
            }
        }

        const stringifyParams = stringify(params);
        this.ctx.logger.info(`→ 调用: ${functionName} | 参数: ${stringifyParams}`);
        let lastResult: ToolCallResult = Failed("Tool call did not execute.");

        for (let attempt = 1; attempt <= this.config.advanced.maxRetry + 1; attempt++) {
            try {
                if (attempt > 1) {
                    this.ctx.logger.info(`  - 重试 (${attempt - 1}/${this.config.advanced.maxRetry})`);
                    await new Promise((resolve) => setTimeout(resolve, this.config.advanced.retryDelay));
                }

                // 3. 使用验证和处理过后的参数执行工具
                /* prettier-ignore */
                lastResult = (await tool.execute({ session, ...validatedParams })) || Failed("Tool call did not execute.");
                const resultString = truncate(stringify(lastResult), 120);

                if (lastResult.status === "success") {
                    this.ctx.logger.success(`✔ 成功 ← 返回: ${resultString}`);
                    return lastResult;
                }
                if (lastResult.error) {
                    if (!lastResult.error.retryable) {
                        this.ctx.logger.warn(`✖ 失败 (不可重试) ← 原因: ${stringify(lastResult.error)}`);
                        return lastResult;
                    } else {
                        this.ctx.logger.warn(`⚠ 失败 (可重试) ← 原因: ${lastResult.error}`);
                        continue;
                    }
                } else {
                    return lastResult;
                }
            } catch (error: any) {
                this.ctx.logger.error(`💥 异常 | 调用 ${functionName} 时出错`, error.message);
                this.ctx.logger.debug(error.stack);
                lastResult = Failed(`Exception: ${error.message}`);
                return lastResult;
            }
        }
        this.ctx.logger.error(`✖ 失败 (耗尽重试) | 工具: ${functionName}`);
        return lastResult;
    }

    public getTool(name: string, session?: Session): ToolDefinition | undefined {
        const tool = this.tools.get(name);
        // 如果没有 session，默认工具可用
        // 如果有 session，则必须通过 isSupported 的检查
        if (!tool || (session && tool.isSupported && !tool.isSupported(session))) {
            return undefined;
        }
        return tool;
    }

    public getAvailableTools(session?: Session): ToolDefinition[] {
        // 如果没有 session，无法进行过滤，返回所有工具
        if (!session) {
            return Array.from(this.tools.values());
        }
        // 如果有 session，则过滤出支持的工具
        return Array.from(this.tools.values()).filter((tool) => !tool.isSupported || tool.isSupported(session));
    }

    public getExtension(name: string): IExtension | undefined {
        return this.extensions.get(name);
    }

    /**
     * 根据工具名称获取其 schema。
     * 如果工具在当前会话中不可用，则返回 undefined。
     * @param name 工具名称
     * @param session 可选的会话对象
     * @returns 工具的 Schema 或 undefined
     */
    public getSchema(name: string, session?: Session): ToolSchema | undefined {
        const tool = this.getTool(name, session);
        return tool ? this._toolDefinitionToSchema(tool) : undefined;
    }

    /**
     * 获取在当前会话中所有可用工具的 Schema 列表。
     * @param session 可选的会话对象
     * @returns 可用工具的 Schema 数组
     */
    public getToolSchemas(session?: Session): ToolSchema[] {
        return this.getAvailableTools(session).map(this._toolDefinitionToSchema);
    }

    /**
     * 将 ToolDefinition 转换为 ToolSchema。
     * @param tool 工具定义对象
     * @returns 工具的 Schema 对象
     */
    private _toolDefinitionToSchema(tool: ToolDefinition): ToolSchema {
        return {
            name: tool.name,
            description: tool.description,
            parameters: extractMetaFromSchema(tool.parameters),
        };
    }
}
