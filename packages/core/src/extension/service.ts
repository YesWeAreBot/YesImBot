import { randomUUID } from "node:crypto";

import { Context, ForkScope, h, Logger, Schema, Session } from "koishi";

import { DEFAULT_BACKGROUND_TOOLS } from "../agent/config";
import { assertReplyTurn, awaitReplyTurn } from "../agent/reply-turn";
import { Config } from "../config";
import type { LoggerService } from "../logger";
import { PromptService } from "../prompt";
import { sanitizeDiagnostic } from "../shared/diagnostic-sanitizer";
import { normalizeAppError, fromAppError } from "../shared/errors";
import { getInstanceDirectory, getInstanceScope } from "../shared/instance-scope";
import { YesImBotService } from "../shared/service";
import { isEmpty, stringify, truncate } from "../shared/utils";
import { conversationChannelId } from "../shared/utils/conversation-scope";
import type { WorldStateService } from "../world";
import { sessionChannelType } from "../world/channel-metadata";
import { BackgroundTools } from "./background-tools";
import CommandExtension from "./builtin/command";
import CoreUtilExtension from "./builtin/core-util";
import InteractionsExtension from "./builtin/interactions";
import MemoryExtension from "./builtin/memory";
import QManagerExtension from "./builtin/qmanager";
import SearchExtension from "./builtin/search";
import { extractMetaFromSchema, Failed } from "./helpers";
import { ToolOutputStore, TOOL_OUTPUT_THRESHOLD, ToolOutputOwner } from "./tool-output-store";
import { IExtension, Properties, ToolCallResult, ToolDefinition, ToolSchema, ToolExecutionContext } from "./types";

const backgroundToolChoices = new WeakMap<object, Map<ToolService, ToolDefinition[]>>();

/** Keep JSON containers and quoted values intact before Koishi's tool-schema validation. */
function parseCommandParams(source: string): Record<string, string> {
    const result: Record<string, string> = Object.create(null);
    let position = 0;
    while (position < source.length) {
        while (/\s/.test(source[position] || "") && position < source.length) position++;
        if (position === source.length) break;
        const match = /^(\w+)=/.exec(source.slice(position));
        if (!match) throw new Error("参数应使用 key=value 格式");
        position += match[0].length;
        const start = position;
        const stack: string[] = [];
        let quote = "";
        for (; position < source.length; position++) {
            const char = source[position];
            if (quote) {
                if (char === "\\") position++;
                else if (char === quote) quote = "";
            } else if (char === '"' || char === "'") quote = char;
            else if (char === "{" || char === "[") stack.push(char === "{" ? "}" : "]");
            else if (char === "}" || char === "]") {
                if (stack.pop() !== char) throw new Error("JSON 括号不匹配");
            } else if (/\s/.test(char) && !stack.length) break;
        }
        if (quote || stack.length) throw new Error("参数中的引号或 JSON 括号未闭合");
        let value = source.slice(start, position);
        if (!value) throw new Error(`参数 ${match[1]} 缺少值`);
        if (value.startsWith('"') && value.endsWith('"')) value = JSON.parse(value);
        else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1).replace(/\\(['\\])/g, "$1");
        result[match[1]] = value;
    }
    return result;
}

function parameterSchemas(schema: Schema, name: string): Schema[] {
    if (schema.type === "object") return schema.dict?.[name] ? [schema.dict[name]] : [];
    if (schema.type === "union" || schema.type === "intersect") return (schema.list || []).flatMap((branch) => parameterSchemas(branch, name));
    if (schema.type === "transform" && schema.inner) return parameterSchemas(schema.inner, name);
    return [];
}

/** Prefer valid strings (notably long IDs); parse JSON only when the declared input rejects a string. */
function convertCommandParams(schema: Schema | undefined, params: Record<string, string>): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(params).map(([name, value]) => {
            const candidates = schema ? parameterSchemas(schema, name) : [];
            const accepts = (input: unknown) =>
                candidates.some((candidate) => {
                    try {
                        candidate(input);
                        return true;
                    } catch {
                        return false;
                    }
                });
            if (accepts(value)) return [name, value];
            try {
                const parsed: unknown = JSON.parse(value);
                if (accepts(parsed)) return [name, parsed];
            } catch {
                /* Full tool-schema validation reports invalid input below. */
            }
            return [name, value];
        }),
    );
}

function processParams(params: Properties, indent = ""): any[] {
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
}

/**
 * ToolService
 * 负责注册、管理和提供所有扩展和工具。
 */
export class ToolService extends YesImBotService<Config> {
    /** Extension contract v1; feature detection also supports source checkouts. */
    public get capabilities() {
        return Object.freeze({ trustedToolSession: 1 as const });
    }

    public readonly background?: BackgroundTools;

    private outputStore?: ToolOutputStore;
    private outputOwnerContext?: Context;

    private tools: Map<string, ToolDefinition> = new Map();
    private schemaStopped = false;
    private extensions: Map<string, IExtension> = new Map();
    // Disabled instances are also retained so their own plugin scope can be re-enabled.
    private knownExtensions: Map<string, IExtension> = new Map();

    private _logger: Logger;
    private promptService: PromptService;

    constructor(
        ctx: Context,
        config: Config,
        private readonly deps: { logging: LoggerService; prompt: PromptService; world: WorldStateService },
    ) {
        super(ctx, config);
        this._logger = deps.logging.getLogger("[工具管理器]");
        this.promptService = deps.prompt;
        this.updateBackgroundToolSchema();
        if (config.backgroundTools?.enabled) this.background = new BackgroundTools(ctx, config.backgroundTools, deps.world, this);
    }

    public async stop() {
        this.background?.dispose();
        this.schemaStopped = true;
        this.updateBackgroundToolSchema();
    }

    public async start() {
        this.outputOwnerContext = this.ctx;
        this.background?.registerCommands();
        this.registerTool({
            name: "tool_output_read",
            description:
                "Read exact pages of a long tool result JSON text. Use nextOffset until null and concatenate text to reconstruct. Offsets count UTF-16 code units. Resources expire after 24 hours or service reload.",
            parameters: Schema.object({
                uri: Schema.string().required(),
                offset: Schema.number().min(0).step(1).default(0),
                limit: Schema.number().min(1).max(8000).step(1).default(6000),
            }),
            execute: async ({ session, ...options }) => {
                try {
                    return { status: "success", result: await this.readToolOutput(session, options as { uri: string; offset?: number; limit?: number }) };
                } catch (error) {
                    return Failed({ name: "ToolOutputReadError", message: error.message, retryable: false });
                }
            },
        });
        const builtinExtensions = [CoreUtilExtension, CommandExtension, MemoryExtension, QManagerExtension, SearchExtension, InteractionsExtension];
        const loadedExtensions = new Map<string, ForkScope>();

        for (const Ext of builtinExtensions) {
            //@ts-ignore
            // 不能在这里判断是否启用，否则无法生成配置
            const name = Ext.prototype.metadata.name;
            const config = this.config.extra?.[name];
            // if (config && !config.enabled) {
            //     this._logger.info(`跳过内置扩展: ${name}`);
            //     continue;
            // }
            //@ts-ignore
            loadedExtensions.set(name, this.ctx.plugin(Ext, config));
        }
        this._registerPromptTemplates();
        this.registerCommands();
        //this._logger.info("服务已启动");
    }

    private registerCommands() {
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
                ].join("\n"),
            )
            .action(async ({ session, options }) => {
                if (!session || !options) return;
                // 1. 获取所有可用工具
                let allTools = this.getAvailableTools(session);

                // 2. 应用过滤器（如果提供了 filter 选项）
                const filterKeyword = options.filter?.toLowerCase();
                if (filterKeyword) {
                    allTools = allTools.filter((t) => t.name.toLowerCase().includes(filterKeyword) || t.description.toLowerCase().includes(filterKeyword));
                }

                const totalCount = allTools.length;

                // 3. 处理没有结果的情况
                if (totalCount === 0) {
                    return options.filter ? `没有找到与 "${options.filter}" 匹配的工具。` : "当前没有可用的工具";
                }

                // 4. 计算分页参数
                const page = options.page ?? 1;
                const size = options.size ?? 20;
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
            .command("tool.invoke <name:string> [params:text]", "调用工具", { authority: 3 })
            .usage(
                [
                    "调用指定的工具并传递参数",
                    '参数格式为 "key=value"，多个参数用空格分隔。',
                    '字符串可写为 key="some value"；数字、布尔和 JSON 按工具参数类型校验。',
                    '例如 payload={"items": [1, 2], "label": "hello world"}；字符串 ID 不会转为数字。',
                ].join("\n"),
            )
            .example(["tool.invoke search_web keyword=koishi"].join("\n"))
            .action(async ({ session }, name, params = "") => {
                if (!name) return "错误：未指定要调用的工具名称";
                const tool = this.getTool(name, session);
                if (!tool) return `未找到工具 "${name}"，或该工具在当前会话不可用。`;
                let parsedParams: Record<string, unknown>;
                try {
                    parsedParams = convertCommandParams(tool.parameters, parseCommandParams(params));
                } catch (error) {
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

        this.ctx
            .command("tool.delete <name:string>", "删除一个已注册的工具", { authority: 3 })
            .usage("根据工具名称，从工具服务中卸载一个工具。此操作是临时的，服务重启后可能会被重新加载")
            .example("tool.delete web_search")
            .action(async ({ session }, name) => {
                if (!session) return "会话不可用";
                if (!name) return "未指定要删除的工具名称";
                const result = this.unregisterTool(name);
                await this.recordFrameworkChange(session, "tool.delete", name, result ? "success" : "failed");
                return result ? `工具 "${name}" 已成功删除。` : `删除失败：未找到名为 "${name}" 的工具。`;
            });

        this.ctx
            .command("extension.list", "列出所有已加载的扩展", { authority: 3 })
            .usage("查询并展示当前所有已成功加载的扩展及其描述")
            .example("extension.list")
            .action(async ({ session }) => {
                const extensions = this.extensions;
                if (extensions.size === 0) {
                    return "当前没有已加载的扩展";
                }
                const extList = Array.from(extensions.values())
                    .map((e) => `- ${e.metadata.name}: ${e.metadata.description}`)
                    .join("\n");
                return `发现 ${extensions.size} 个已加载的扩展：\n${extList}`;
            });

        for (const enabled of [true, false]) {
            const operation = enabled ? "enable" : "disable";
            const label = enabled ? "启用" : "禁用";
            this.ctx
                .command(`extension.${operation} <name:string>`, `${label}扩展`, { authority: 3 })
                .usage("内置扩展更新当前实例的 extra 配置；外部扩展更新其自身插件配置。保存后重载对应插件并保留其他设置。")
                .action(async ({ session }, name) => {
                    if (!session) return "会话不可用";
                    if (!name) return "未指定扩展名称";
                    try {
                        // Prefer registered instances, including disabled builtins. Retain the
                        // module lookup for external extensions that export an instance.
                        const ext = this.knownExtensions.get(name) || (enabled ? ((await import(name)) as IExtension) : undefined);
                        if (!ext?.metadata?.name || !ext.ctx?.scope) return "扩展未找到或无法定位其插件配置";
                        const scope = ext.metadata.builtin ? this.ctx.scope : ext.ctx.scope;
                        const current = scope.config;
                        const data = ext.metadata.builtin
                            ? { ...current, extra: { ...current.extra, [ext.metadata.name]: { ...current.extra?.[ext.metadata.name], enabled } } }
                            : { ...current, enabled };
                        // Do not pass false: it saves but suppresses both update callbacks and reload.
                        scope.update(data);
                        await this.recordFrameworkChange(session, `extension.${operation}`, ext.metadata.name, "success");
                        return `${label}成功`;
                    } catch (error) {
                        return `${label}失败: ${error.message}`;
                    }
                });
        }
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
        const validate: Schema<any> = (extensionInstance.constructor as any)["Config"];
        const validatedConfig = validate ? validate(extConfig) : extConfig;

        let availableExtensions = this.ctx.schema.get("toolService.availableExtensions");

        if (availableExtensions.type !== "object") {
            availableExtensions = Schema.object({});
        }

        try {
            if (!extensionInstance.metadata || !extensionInstance.metadata.name) {
                this._logger.warn("一个扩展在注册时缺少元数据或名称，已跳过");
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
                                    ...(validate ? validate.default(validatedConfig) : Schema.object({})).dict,
                                }),
                                Schema.object(Object.fromEntries(Object.entries(validate?.dict || {}).map(([key, schema]) => [key, schema.hidden()]))),
                            ]),
                        ]),
                    ),
                );
            }

            const previous = this.knownExtensions.get(metadata.name);
            if (previous && previous !== extensionInstance) this.unregister(metadata.name, previous);
            this.knownExtensions.set(metadata.name, extensionInstance);

            if (!enabled) {
                // this._logger.info(`扩展 "${metadata.name}" 已禁用`);
                return;
            }

            const display = metadata.display || metadata.name;

            this._logger.info(`正在注册扩展: "${display}"`);
            this.extensions.set(metadata.name, extensionInstance);

            if (extensionInstance.tools) {
                for (const [name, tool] of extensionInstance.tools.entries()) {
                    this._logger.debug(`  -> 注册工具: "${tool.name}"`);
                    this.tools.set(name, tool);
                }
                this.updateBackgroundToolSchema();
            }

            // this._logger.debug(`扩展 "${metadata.name}" 已加载`);
        } catch (error) {
            this._logger.error(`扩展配置验证失败: ${error.message}`);
            return;
        }
    }

    public unregister(name: string, expected?: IExtension): boolean {
        const ext = this.knownExtensions.get(name);
        // A disposed old plugin must not unregister a newer instance with the same name.
        if (!ext || (expected && ext !== expected)) return false;
        this.knownExtensions.delete(name);
        if (this.extensions.get(name) === ext) this.extensions.delete(name);
        for (const definition of ext.tools?.values() || []) {
            // Another extension (or registerTool) may have replaced a colliding name.
            if (this.tools.get(definition.name) === definition) this.unregisterTool(definition.name);
        }
        this._logger.info(`已卸载扩展: "${name}"`);
        return true;
    }

    private updateBackgroundToolSchema() {
        // Root ownership keeps shared choices alive when an individual plugin is disposed.
        const schema = this.ctx.root?.schema ?? this.ctx.schema;
        if (!schema?.set) return;
        const identity = schema._data ?? schema;
        let instances = backgroundToolChoices.get(identity);
        if (!instances) backgroundToolChoices.set(identity, (instances = new Map()));
        if (this.schemaStopped) instances.delete(this);
        else
            instances.set(
                this,
                [...this.tools.values()].filter((tool) => tool.background && !tool.name.startsWith("background_task_")),
            );
        const choices = new Map(DEFAULT_BACKGROUND_TOOLS.map((name) => [name, name]));
        for (const tools of instances.values()) {
            for (const tool of tools) choices.set(tool.name, `${tool.name}：${tool.description.split("\n")[0].slice(0, 80)}`);
        }
        schema.set(
            "toolService.backgroundEligibleTools",
            Schema.array(Schema.union([...choices].map(([name, label]) => Schema.const(name).description(label))))
                .role("checkbox")
                .default([...DEFAULT_BACKGROUND_TOOLS]),
        );
    }

    public registerTool(definition: ToolDefinition) {
        this.tools.set(definition.name, definition);
        this.updateBackgroundToolSchema();
        return () => {
            if (this.tools.get(definition.name) === definition) this.unregisterTool(definition.name);
        };
    }

    public unregisterTool(name: string) {
        const removed = this.tools.delete(name);
        if (removed) this.updateBackgroundToolSchema();
        return removed;
    }

    private async recordFrameworkChange(session: Session, operation: string, name: string, status: string) {
        const world = this.deps.world;
        if (!world?.recordSystemEvent || !session?.channelId) return;
        try {
            await world.recordSystemEvent({
                id: randomUUID(),
                platform: session.platform,
                channelId: conversationChannelId(session)!,
                eventScope: "global",
                type: "framework-maintenance",
                timestamp: new Date(),
                payload: {
                    actor: `admin:${session.platform}:${session.userId}`,
                    operation,
                    status,
                    scope: "global",
                    origin: { platform: session.platform, selfId: session.selfId, channelId: session.channelId, adapter: session.bot?.platform },
                    target: { service: "yesimbot.tool", name },
                    time: new Date().toISOString(),
                },
                message: "工具服务全局维护结果；只影响当前运行进程，重启后按配置重新加载。",
            });
        } catch (error) {
            this._logger.warn(`框架维护事件投递失败：${String(error)}`);
        }
    }

    public async invoke(functionName: string, params: Record<string, unknown>, session?: Session, toolContext?: ToolExecutionContext): Promise<ToolCallResult> {
        const scopedBackground = toolContext?.backgroundExecution || functionName.startsWith("background_task_");
        const startedAt = new Date(),
            requestId = randomUUID();
        // Fix trusted identity and clear generation before the tool can await external work.
        const capture =
            session && typeof this.ctx?.filter === "function" && this.deps.world?.l2_manager
                ? ToolService.prototype.captureOutputOwner.call(this, session)
                : undefined;
        let result = await this.executeInvocation(functionName, params, session, toolContext);
        if (session && functionName !== "tool_output_read" && result.status === "success" && result.result !== undefined) {
            try {
                const text = JSON.stringify(result.result, (_key, value) => {
                    if (["function", "symbol", "bigint"].includes(typeof value) || (typeof value === "number" && !Number.isFinite(value)))
                        throw new Error("Tool result contains a non-JSON value");
                    return value;
                });
                if (text === undefined) throw new Error("Tool result is not JSON serializable");
                if (text.length > TOOL_OUTPUT_THRESHOLD) {
                    if (!capture) throw new Error("Tool output resource requires a scoped authorized session");
                    capture.assertCurrent();
                    const store = ToolService.prototype.getOutputStore.call(this);
                    const resource = await store.save(text, capture.owner, capture.assertCurrent);
                    capture.assertCurrent();
                    result = { ...result, result: resource };
                }
            } catch (error) {
                // Execution already completed: archival failure must never trigger a retry of its side effects.
                result = {
                    ...result,
                    result: {
                        kind: "tool-output-unavailable",
                        message: "Tool completed; result payload could not be serialized or archived. Do not retry the completed tool.",
                    },
                    metadata: { ...result.metadata, payloadError: { name: "ToolOutputError", message: error.message, retryable: false } },
                };
            }
        }
        assertReplyTurn();
        if (scopedBackground) {
            try {
                capture?.assertCurrent();
            } catch {
                return Failed({ name: "BackgroundTaskInvalidated", message: "后台任务结果已失效；请重新查询，勿重复提交已执行任务", retryable: false });
            }
        }
        const world = this.deps.world;
        if (session?.platform && session.channelId && world?.recordSystemEvent) {
            const channelId = conversationChannelId(session)!;
            try {
                const admin = session.argv?.command?.name === "tool.invoke" || toolContext?.invocationActor === "admin";
                const historyGeneration =
                    scopedBackground || result.result?.kind === "tool-output-resource" || result.metadata?.payloadError
                        ? capture?.owner.generation
                        : Number.isSafeInteger(result.result?.historyGeneration)
                          ? result.result.historyGeneration
                          : undefined;
                const recorded = await awaitReplyTurn(() =>
                    world.recordSystemEvent(
                        {
                            id: requestId,
                            platform: session.platform,
                            channelId,
                            eventScope: "channel",
                            type: "tool-result",
                            timestamp: new Date(),
                            payload: {
                                requestId,
                                actor: admin ? `admin:${session.platform}:${session.userId}` : "model",
                                requester: session.userId,
                                operation: functionName,
                                scope: "channel",
                                origin: {
                                    platform: session.platform,
                                    selfId: session.selfId,
                                    adapter: session.bot?.platform,
                                    channelId: session.channelId,
                                    guildId: session.guildId,
                                },
                                target: { platform: session.platform, selfId: session.selfId, channelId: session.channelId, guildId: session.guildId },
                                startedAt: startedAt.toISOString(),
                                finishedAt: new Date().toISOString(),
                                status: result.status,
                                receipt: JSON.stringify(sanitizeDiagnostic(result)).slice(0, 2000),
                            },
                            message: "框架工具调用已返回；记录的状态是工具回执，不代表所有外部副作用均已核实。",
                        },
                        historyGeneration,
                    ),
                );
                if (recorded === false && historyGeneration !== undefined) {
                    if (scopedBackground)
                        return Failed({ name: "BackgroundTaskInvalidated", message: "后台任务结果已失效；请重新查询，勿重复提交已执行任务", retryable: false });
                    if (result.result?.kind !== "tool-output-resource" && !result.metadata?.payloadError) return Failed("召回后历史已清除，请重新召回");
                    result = {
                        ...result,
                        result: {
                            kind: "tool-output-unavailable",
                            message: "Tool completed; output expired after history clear. Do not retry the completed tool.",
                        },
                        metadata: {
                            ...result.metadata,
                            payloadError: { name: "ToolOutputError", message: "History cleared before receipt publication", retryable: false },
                        },
                    };
                }
            } catch (error) {
                assertReplyTurn();
                this._logger.warn(`工具结果事件投递失败：${String(error)}`);
            }
        }
        assertReplyTurn();
        if (result.result?.kind === "tool-output-resource") {
            try {
                capture?.assertCurrent();
            } catch (error) {
                result = {
                    ...result,
                    result: {
                        kind: "tool-output-unavailable",
                        message: "Tool completed; output authorization or history changed. Do not retry the completed tool.",
                    },
                    metadata: { ...result.metadata, payloadError: { name: "ToolOutputError", message: error.message, retryable: false } },
                };
            }
        }
        if (scopedBackground) {
            try {
                capture?.assertCurrent();
            } catch {
                return Failed({ name: "BackgroundTaskInvalidated", message: "后台任务结果已失效；请重新查询，勿重复提交已执行任务", retryable: false });
            }
        }
        return result;
    }

    private getOutputStore() {
        return (this.outputStore ??= new ToolOutputStore(getInstanceDirectory(this.outputOwnerContext ?? this.ctx, "data/yesimbot/tool-outputs")));
    }

    private captureOutputOwner(session: Session) {
        const ctx = this.outputOwnerContext ?? this.ctx;
        const world = this.deps.world;
        const channelType = sessionChannelType(session);
        const owner: ToolOutputOwner = {
            instance: getInstanceScope(ctx),
            platform: session.platform,
            selfId: session.selfId,
            channelId: conversationChannelId(session)!,
            channelType: channelType!,
            privateUserId: channelType === "private" ? session.userId : undefined,
            generation: world.l2_manager.getHistoryGeneration({ platform: session.platform, channelId: conversationChannelId(session)!, channelType }),
        };
        const binding = () =>
            JSON.stringify([session.platform, session.selfId, session.channelId, sessionChannelType(session), session.userId, session.guildId]);
        const original = binding();
        const assertCurrent = () => {
            if (
                !owner.platform ||
                !owner.selfId ||
                !owner.channelId ||
                !owner.channelType ||
                (owner.channelType === "private" && !owner.privateUserId) ||
                binding() !== original
            )
                throw new Error("Tool output session identity missing or changed");
            if (!ctx.filter(session) || !world.isChannelAllowed(session)) throw new Error("Tool output session authorization revoked");
            if (world.l2_manager.getHistoryGeneration(owner) !== owner.generation) throw new Error("Tool output history generation expired after clear");
        };
        return { owner, assertCurrent };
    }

    public async readToolOutput(session: Session | undefined, options: { uri: string; offset?: number; limit?: number }) {
        if (!session) throw new Error("Tool output read requires an authenticated session");
        const captured = this.captureOutputOwner(session);
        captured.assertCurrent();
        const page = await this.getOutputStore().read(options.uri, captured.owner, options.offset, options.limit, captured.assertCurrent);
        captured.assertCurrent();
        return page;
    }

    private async executeInvocation(
        functionName: string,
        params: Record<string, unknown>,
        session?: Session,
        toolContext?: ToolExecutionContext,
    ): Promise<ToolCallResult> {
        // 1. 获取工具，这里已经包含了 isSupported 的检查
        const tool = this.getTool(functionName, session);
        if (!tool) {
            this._logger.warn(`工具未找到或在当前会话中不可用 | 名称: ${functionName}`);
            return Failed(`Tool ${functionName} not found or not supported in this context.`);
        }

        // 2. 参数验证 (新加的优雅方案)
        let validatedParams = params;
        if (tool.parameters) {
            try {
                // Schema 对象本身就是验证函数
                validatedParams = tool.parameters(params);
            } catch (error) {
                this._logger.warn(`✖ 参数验证失败 | 工具: ${functionName} | 错误: ${error.message}`);
                // 将详细的验证错误返回给 AI
                return Failed(`Parameter validation failed: ${error.message}`); // 参数错误不可重试
            }
        }

        const stringifyParams = stringify(params);
        this._logger.info(`→ 调用: ${functionName} | 参数: ${stringifyParams}`);
        let lastResult: ToolCallResult = Failed("Tool call did not execute.");

        for (let attempt = 1; attempt <= (this.config.advanced?.maxRetry ?? 0) + 1; attempt++) {
            try {
                if (attempt > 1) {
                    this._logger.info(`  - 重试 (${attempt - 1}/${this.config.advanced?.maxRetry ?? 0})`);
                    let timer: ReturnType<typeof setTimeout>;
                    try {
                        await awaitReplyTurn(
                            () =>
                                new Promise<void>((resolve) => {
                                    timer = setTimeout(resolve, this.config.advanced?.retryDelay ?? 1000);
                                }),
                        );
                    } finally {
                        clearTimeout(timer!);
                    }
                }

                assertReplyTurn();
                // 3. 使用验证和处理过后的参数执行工具
                /* prettier-ignore */
                const execute = () => tool.execute({ ...validatedParams, session, toolContext });
                lastResult = (await (toolContext?.backgroundExecution ? execute() : awaitReplyTurn(execute))) || Failed("Tool call did not execute.");
                assertReplyTurn();
                const resultString = truncate(stringify(lastResult), 120);

                if (lastResult.status === "success") {
                    this._logger.success(`✔ 成功 ← 返回: ${resultString}`);
                    return lastResult;
                }
                if (lastResult.error) {
                    if (!lastResult.error.retryable) {
                        this._logger.warn(`✖ 失败 (不可重试) ← 原因: ${stringify(lastResult.error)}`);
                        return lastResult;
                    } else {
                        this._logger.warn(`⚠ 失败 (可重试) ← 原因: ${lastResult.error}`);
                        continue;
                    }
                } else {
                    return lastResult;
                }
            } catch (error) {
                assertReplyTurn();
                const normalized = normalizeAppError(error);
                this._logger.error(`💥 异常 | 调用 ${functionName} 时出错`, { code: normalized.code, errorId: normalized.errorId });
                this._logger.debug(sanitizeDiagnostic(normalized));
                lastResult = Failed(fromAppError(normalized));
                return lastResult;
            }
        }
        this._logger.error(`✖ 失败 (耗尽重试) | 工具: ${functionName}`);
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
        return Array.from(this.tools.values())
            .filter((tool) => !tool.isSupported || tool.isSupported(session))
            .map((tool) =>
                this.background && tool.background
                    ? { ...tool, description: tool.description + " [Supports background_task_start for independent work.]" }
                    : tool,
            );
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
