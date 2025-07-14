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
import { IExtension, Properties, ToolCallResult, ToolDefinition, ToolSchema } from "./types";
import Mustache from "mustache";

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

        this.ctx.command("tool", "工具管理指令集");
        this.ctx.command("extension", "扩展管理指令集");

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
                        (t) =>
                            t.name.toLowerCase().includes(filterKeyword) ||
                            t.description.toLowerCase().includes(filterKeyword)
                    );
                }

                const totalCount = allTools.length;

                // 3. 处理没有结果的情况
                if (totalCount === 0) {
                    return options.filter ? `没有找到与 "${options.filter}" 匹配的工具。` : "当前没有可用的工具。";
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
            .command("tool.info", "显示工具的详细信息", { authority: 3 })
            .usage("查询并展示指定工具的详细信息，包括名称、描述、参数等。")
            .example("tool.info search_web")
            .action(async ({ session }, name) => {
                function prepareDataForTemplate(tool: ToolSchema) {
                    // 递归函数，处理参数并添加缩进
                    const processParams = (params: Properties, indent = ""): any[] => {
                        return Object.entries(params).map(([key, param]) => {
                            const processedParam: any = {
                                ...param,
                                key: key,
                                indent: indent,
                            };

                            // 如果是对象，递归处理其属性
                            if (param.properties) {
                                processedParam.properties = processParams(param.properties, indent + "    ");
                            }

                            // 如果是数组且数组成员是复杂对象，递归处理
                            if (param.items) {
                                // 将单个 item 包装成数组，以便局部模板可以统一处理
                                processedParam.items = [
                                    {
                                        ...param.items,
                                        key: "item", // 为数组项提供一个通用名称
                                        indent: indent + "    ",
                                        // 递归处理数组项的属性（如果它是一个对象）
                                        ...(param.items.properties && {
                                            properties: processParams(param.items.properties, indent + "        "),
                                        }),
                                    },
                                ];
                            }
                            return processedParam;
                        });
                    };

                    // 转换每个工具的参数
                    return {
                        ...tool,
                        parameters: tool.parameters ? processParams(tool.parameters) : [],
                    };
                }

                const tool = this.getSchema(name);
                if (!tool) {
                    return `未找到名为 "${name}" 的工具。`;
                }
                const template = `# 工具名称: {{name}}
## 描述
{{description}}

## 参数
{{#parameters}}
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
{{> paramDetail}}
{{/.}}
{{/properties}}
{{#items}}
    - 数组项 (每个项都是一个 '{{type}}'):
{{> paramDetail}}
{{/items}}
{{/parameters}}
{{^parameters}}
此工具无需任何参数。
{{/parameters}}`;

                const rendered = Mustache.render(template, prepareDataForTemplate(tool));

                return rendered;
            });

        this.ctx
            .command("tool.invoke <name:string> [...params:string]", "调用工具", { authority: 3 })
            .usage(
                `调用指定的工具并传递参数。\n参数格式为 "key=value"，多个参数用空格分隔。\n如果 value 包含空格，请使用引号将其包裹，例如：key="some value"`
            )
            .example(["tool.invoke search_web keyword=koishi"].join("\n"))
            .action(async ({ session }, name, ...params) => {
                if (!name) return "错误：未指定要调用的工具名称。";

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
                } catch (error) {
                    return `参数解析失败：${error.message}\n请检查您的参数格式是否正确（key=value）。`;
                }

                const result = await this.invoke(name, parsedParams, session);

                // 使用消息元素美化输出
                // if (result.status === "success") {
                //     const output = stringify(result.result, 2);
                //     return `<fragment>
                //             <p>✅ 工具 {name} 调用成功！</p>
                //             <p>执行结果：</p>
                //             <quote>{truncate(output, 1000)}</quote>
                //         </fragment>`;
                // } else {
                //     return `<fragment>
                //             <p>❌ 工具 {name} 调用失败。</p>
                //             <p>原因：{result.error}</p>
                //         </fragment>`;
                // }

                if (result.status === "success") {
                    return `✅ 工具 ${name} 调用成功！\n执行结果：${
                        typeof result.result === "string" ? result.result : JSON.stringify(result.result, null, 2)
                    }`;
                } else {
                    return `❌ 工具 ${name} 调用失败。\n原因：${result.error}`;
                }
            });

        this.ctx
            .command("tool.delete <name:string>", "删除一个已注册的工具", { authority: 3 })
            .usage("根据工具名称，从工具服务中卸载一个工具。此操作是临时的，服务重启后可能会被重新加载。")
            .example("tool.delete search.web")
            .action(async ({ session }, name) => {
                if (!name) return "错误：未指定要删除的工具名称。";
                const result = this.unregisterTool(name);
                return result ? `工具 "${name}" 已成功删除。` : `删除失败：未找到名为 "${name}" 的工具。`;
            });

        this.ctx
            .command("extension.list", "列出所有已加载的扩展", { authority: 3 })
            .usage("查询并展示当前所有已成功加载的扩展及其描述。")
            .example("extension.list")
            .action(async ({ session }) => {
                const extensions = this.extensions;
                if (extensions.size === 0) {
                    return "当前没有已加载的扩展。";
                }
                const extList = Array.from(extensions.values())
                    .map((e) => `- ${e.metadata.name}: ${e.metadata.description}`)
                    .join("\n");
                return `发现 ${extensions.size} 个已加载的扩展：\n${extList}`;
            });

        this.ctx.command("extension.enable <name:string>", "启用扩展").action(async ({ session }, name) => {
            try {
                const ext = (await import(name)) as IExtension;
                if (!ext) {
                    return `扩展未找到`;
                }
                this.register(ext, true, {});
                return `启用成功`;
            } catch (error) {
                return `启用失败: ${error.message}`;
            }
        });

        this.ctx.command("extension.disable <name:string>", "禁用扩展").action(async ({ session }, name) => {
            const result = this.unregister(name);
            return result ? `禁用成功` : `禁用失败`;
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
                        //config: validate && enabled ? validate.default(validatedConfig) : Schema.object({}),
                        ...(validate && enabled ? validate.default(validatedConfig) : Schema.object({})).dict,
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
        return this.tools.delete(name);
    }

    public async invoke(
        functionName: string,
        params: Record<string, unknown>,
        session?: Session
    ): Promise<ToolCallResult> {
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

    public getToolSchemas(): ToolSchema[] {
        return Array.from(this.tools.values()).map((tool) => this.getSchema(tool.name));
    }
}
