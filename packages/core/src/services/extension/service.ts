import { Context, ForkScope, h, Schema, Service } from "koishi";

import { Config } from "@/config";
import { PromptService } from "@/services/prompt";
import { Services } from "@/shared/constants";
import { isEmpty, stringify, truncate } from "@/shared/utils";
import { AnyAgentStimulus, StimulusSource, UserMessageStimulus } from "../worldstate/types";
import { IExtension, Properties, ToolDefinition, ToolResult, ToolSchema, ToolContext } from "./types";
import { ContextCapabilityMap } from "./types/context";
import { StimulusContextAdapter } from "./context";
import { Failed } from "./result-builder";

// Helper function to extract metadata from Schema (moved from deleted helpers.ts)
function extractMetaFromSchema(schema: Schema | undefined): Properties {
    if (!schema) return {};
    const meta = schema?.meta as any;
    if (!meta) return {};

    const properties: Properties = {};
    for (const [key, value] of Object.entries(meta)) {
        if (typeof value === "object" && value !== null) {
            properties[key] = value as any;
        }
    }
    return properties;
}

import CoreUtilExtension from "./builtin/core-util";
import InteractionsExtension from "./builtin/interactions";
import MemoryExtension from "./builtin/memory";
import QManagerExtension from "./builtin/qmanager";

declare module "koishi" {
    interface Context {
        [Services.Tool]: ToolService;
    }
}

export class ToolService extends Service<Config> {
    static readonly inject = [Services.Prompt];
    private tools: Map<string, ToolDefinition> = new Map();
    private extensions: Map<string, IExtension> = new Map();

    private promptService: PromptService;
    private contextAdapter: StimulusContextAdapter;

    constructor(ctx: Context, config: Config) {
        super(ctx, Services.Tool, true);
        this.config = config;
        this.promptService = ctx[Services.Prompt];
        this.contextAdapter = new StimulusContextAdapter(ctx);
        this.logger.level = this.config.logLevel;
    }

    protected async start() {
        const builtinExtensions = [CoreUtilExtension, MemoryExtension, QManagerExtension, InteractionsExtension];
        const loadedExtensions = new Map<string, ForkScope>();

        for (const Ext of builtinExtensions) {
            //@ts-ignore
            // 不能在这里判断是否启用，否则无法生成配置
            const name = Ext.prototype.metadata.name;
            const config = this.config.extra[name];
            //@ts-ignore
            loadedExtensions.set(name, this.ctx.plugin(Ext, config));
        }
        this.registerPromptTemplates();
        this.registerCommands();
    }

    private registerCommands() {
        const cmd = this.ctx.command("tool", "工具管理指令集", { authority: 3 });

        cmd.subcommand(".list", "列出所有可用工具")
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
                // TODO: This command needs to be refactored to work without a session.
                // For now, it will list all registered tools.
                let allTools = Array.from(this.tools.values());

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

        cmd.subcommand(".info <name:string>", "显示工具的详细信息")
            .usage("查询并展示指定工具的详细信息，包括名称、描述、参数等")
            .example("tool.info search_web")
            .action(async ({ session }, name) => {
                if (!name) return "未指定要查询的工具名称";
                // TODO: Refactor to work without session
                const renderResult = await this.promptService.render("tool.info", { toolName: name });

                if (!renderResult) {
                    return `未找到名为 "${name}" 的工具或渲染失败。`;
                }

                return h.escape(renderResult);
            });

        cmd.subcommand(".invoke <name:string> [...params:string]", "调用工具")
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

                // TODO: Refactor to work without session. A mock context is needed.
                if (!session) return "此指令需要在一个会话上下文中使用。";

                const stimulus: UserMessageStimulus = {
                    type: StimulusSource.UserMessage,
                    priority: 1,
                    timestamp: new Date(),
                    payload: session,
                };

                const context = this.getContext(stimulus);
                const result = await this.invoke(name, parsedParams, context);

                if (result.status === "success") {
                    /* prettier-ignore */
                    return `✅ 工具 ${name} 调用成功！\n执行结果：${isEmpty(result.result) ? "无返回值" : stringify(result.result, 2)}`;
                } else {
                    return `❌ 工具 ${name} 调用失败。\n原因：${stringify(result.error)}`;
                }
            });
    }

    private registerPromptTemplates() {
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

        this.promptService.registerSnippet("tool", async (context) => {
            const { toolName } = context;
            // TODO: Refactor to work without session
            const tool = await this.getSchema(toolName);
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
     * 注册一个新的扩展
     * @param ExtConstructor 扩展的构造函数
     * @param enabled 是否启用此扩展
     * @param extConfig 传递给扩展实例的配置
     */
    public register<TConfig = any>(extensionInstance: IExtension<TConfig>, enabled: boolean, extConfig: TConfig = {} as TConfig) {
        const validate: Schema<TConfig> = extensionInstance.constructor["Config"];
        const validatedConfig = validate ? validate(extConfig) : extConfig;

        let availableExtensions = this.ctx.schema.get("toolService.availableExtensions");

        if (availableExtensions.type !== "object") {
            availableExtensions = Schema.object({});
        }

        try {
            if (!extensionInstance.metadata || !extensionInstance.metadata.name) {
                this.logger.warn("一个扩展在注册时缺少元数据或名称，已跳过");
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
                return;
            }

            const display = metadata.display || metadata.name;

            this.logger.info(`正在注册扩展: "${display}"`);
            this.extensions.set(metadata.name, extensionInstance);

            if (extensionInstance.tools) {
                for (const [name, tool] of extensionInstance.tools.entries()) {
                    this.logger.debug(`  -> 注册工具: "${tool.name}"`);
                    const boundTool = {
                        ...tool,
                        extensionName: metadata.name,
                    } as ToolDefinition;
                    extensionInstance.tools.set(name, boundTool);
                    this.tools.set(name, boundTool);
                }
            }
        } catch (error: any) {
            this.logger.error(`扩展配置验证失败: ${error.message}`);
            return;
        }
    }

    public unregister(name: string): boolean {
        const ext = this.extensions.get(name);
        if (!ext) {
            this.logger.warn(`尝试卸载不存在的扩展: "${name}"`);
            return false;
        }
        this.extensions.delete(name);
        try {
            for (const tool of ext.tools.values()) {
                this.tools.delete(tool.name);
            }
            this.logger.info(`已卸载扩展: "${name}"`);
        } catch (error: any) {
            this.logger.warn(`卸载扩展 ${name} 时出错：${error.message}`);
        }
        return true;
    }

    /**
     * Get ToolContext from stimulus.
     */
    public getContext(stimulus: AnyAgentStimulus, extras?: Partial<ContextCapabilityMap>): ToolContext {
        return this.contextAdapter.fromStimulus(stimulus, extras);
    }

    public async invoke(functionName: string, params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const tool = await this.getTool(functionName, context);
        if (!tool) {
            this.logger.warn(`工具未找到或在当前上下文中不可用 | 名称: ${functionName}`);
            return Failed(`Tool ${functionName} not found or not supported in this context.`);
        }

        let validatedParams = params;
        if (tool.parameters) {
            try {
                validatedParams = tool.parameters(params);
            } catch (error: any) {
                this.logger.warn(`✖ 参数验证失败 | 工具: ${functionName} | 错误: ${error.message}`);
                return Failed(`Parameter validation failed: ${error.message}`);
            }
        }

        const stringifyParams = stringify(params);
        this.logger.info(`→ 调用: ${functionName} | 参数: ${stringifyParams}`);
        let lastResult: ToolResult = Failed("Tool call did not execute.");

        for (let attempt = 1; attempt <= this.config.advanced.maxRetry + 1; attempt++) {
            try {
                if (attempt > 1) {
                    this.logger.info(`  - 重试 (${attempt - 1}/${this.config.advanced.maxRetry})`);
                    await new Promise((resolve) => setTimeout(resolve, this.config.advanced.retryDelay));
                }

                const executionResult = await tool.execute(validatedParams, context);

                // Handle both direct ToolResult and builder transparently
                if (executionResult && "build" in executionResult && typeof executionResult.build === "function") {
                    lastResult = executionResult.build();
                } else if (executionResult && "status" in executionResult) {
                    lastResult = executionResult as ToolResult;
                } else {
                    lastResult = Failed("Tool call did not return a valid result.");
                }

                const resultString = truncate(stringify(lastResult), 120);

                if (lastResult.status === "success") {
                    this.logger.success(`✔ 成功 ← 返回: ${resultString}`);
                    return lastResult;
                }
                if (lastResult.error) {
                    if (!lastResult.error.retryable) {
                        this.logger.warn(`✖ 失败 (不可重试) ← 原因: ${stringify(lastResult.error)}`);
                        return lastResult;
                    } else {
                        this.logger.warn(`⚠ 失败 (可重试) ← 原因: ${stringify(lastResult.error)}`);
                        continue;
                    }
                } else {
                    return lastResult;
                }
            } catch (error: any) {
                this.logger.error(`💥 异常 | 调用 ${functionName} 时出错`, error.message);
                this.logger.debug(error.stack);
                lastResult = Failed(`Exception: ${error.message}`);
                return lastResult;
            }
        }
        this.logger.error(`✖ 失败 (耗尽重试) | 工具: ${functionName}`);
        return lastResult;
    }

    public async getTool(name: string, context?: ToolContext): Promise<ToolDefinition | undefined> {
        const tool = this.tools.get(name);
        if (!tool) return undefined;

        if (!context) {
            return tool;
        }

        const assessment = await this.assessTool(tool, context);
        if (!assessment.available) {
            if (assessment.hints.length) {
                this.logger.debug(`工具不可用 | 名称: ${tool.name} | 原因: ${assessment.hints.join("; ")}`);
            }
            return undefined;
        }

        return tool;
    }

    public async getAvailableTools(context: ToolContext): Promise<ToolDefinition[]> {
        const evaluations = await this.evaluateTools(context);

        return evaluations
            .filter((record) => record.assessment.available)
            .sort((a, b) => (b.assessment.priority ?? 0) - (a.assessment.priority ?? 0))
            .map((record) => record.tool);
    }

    public getExtension(name: string): IExtension | undefined {
        return this.extensions.get(name);
    }

    public async getSchema(name: string, context?: ToolContext): Promise<ToolSchema | undefined> {
        const tool = await this.getTool(name, context);
        return tool ? this.toolDefinitionToSchema(tool) : undefined;
    }

    public async getToolSchemas(context: ToolContext): Promise<ToolSchema[]> {
        const evaluations = await this.evaluateTools(context);

        return evaluations
            .filter((record) => record.assessment.available)
            .sort((a, b) => (b.assessment.priority ?? 0) - (a.assessment.priority ?? 0))
            .map((record) => this.toolDefinitionToSchema(record.tool, record.assessment.hints));
    }

    public getConfig(name: string): any {
        const ext = this.extensions.get(name);
        if (!ext) return null;
        return ext.config;
    }

    /* prettier-ignore */
    private async evaluateTools(context: ToolContext): Promise<{ tool: ToolDefinition; assessment: { available: boolean; priority: number; hints: string[] }}[]> {
        return Promise.all(
            Array.from(this.tools.values()).map(async (tool) => ({
                tool,
                assessment: await this.assessTool(tool, context),
            }))
        );
    }

    /* prettier-ignore */
    private async assessTool(tool: ToolDefinition, context: ToolContext): Promise<{ available: boolean; priority: number; hints: string[] }> {
        const config = this.getConfig(tool.extensionName);
        const hints: string[] = [];
        let priority = 0;

        // Check support guards
        if (tool.supports?.length) {
            for (const guard of tool.supports) {
                try {
                    const guardContext = { context, config };
                    const result = guard(guardContext);
                    if (result === false) {
                        return { available: false, priority: 0, hints };
                    }
                    if (typeof result === "object") {
                        if (result.reason) {
                            hints.push(result.reason);
                        }
                        if (result.ok === false) {
                            return { available: false, priority: 0, hints };
                        }
                    }
                } catch (error: any) {
                    this.logger.warn(`工具支持检查失败 | 工具: ${tool.name} | 错误: ${error.message ?? error}`);
                    return { available: false, priority: 0, hints };
                }
            }
        }

        // Check activators
        if (tool.activators?.length) {
            for (const activator of tool.activators) {
                try {
                    const activatorContext = { context, config };
                    const result = await activator(activatorContext);
                    if (!result.allow) {
                        if (result.hints?.length) {
                            hints.push(...result.hints);
                        }
                        return { available: false, priority: 0, hints };
                    }
                    if (result.hints?.length) {
                        hints.push(...result.hints);
                    }
                    if (typeof result.priority === "number") {
                        priority = Math.max(priority, result.priority);
                    }
                } catch (error: any) {
                    this.logger.warn(`工具激活器执行失败 | 工具: ${tool.name} | 错误: ${error.message ?? error}`);
                    return { available: false, priority: 0, hints };
                }
            }
        }

        return { available: true, priority, hints };
    }

    /**
     * 将 ToolDefinition 转换为 ToolSchema
     * @param tool 工具定义对象
     * @returns 工具的 Schema 对象
     */
    private toolDefinitionToSchema(tool: ToolDefinition, hints: string[] = []): ToolSchema {
        return {
            name: tool.name,
            description: tool.description,
            parameters: extractMetaFromSchema(tool.parameters),
            type: tool.type,
            hints: hints.length ? hints : undefined,
        };
    }
}
