import { ImagePart, Message, TextPart } from '@xsai/shared-chat';
import { ToolResult } from '@xsai/tool';
import { message } from '@xsai/utils-chat';
import { XMLParser } from "fast-xml-parser";
import { Context, Random, Session } from "koishi";

const { assistant, user, system, textPart } = message;

import { AdapterSwitcher } from "./adapters";
import { getFunctionSchema } from "./adapters/schema";
import { Config } from "./config";
import { ToolManager } from "./extensions/base";
import { EmojiManager } from "./managers/emojiManager";
import { LLMResponse, Tool } from "./models/LLMResponse";
import { ImageViewer } from "./services/imageViewer";
import { toolsToString } from "./utils";
import { extractJSONFromString } from "./utils/parse-structured-output";
import { isEmpty, isNotEmpty } from "./utils/string";
import { ResponseVerifier } from "./utils/verifier";


interface Dependencies {
    readonly ctx: Context;
    readonly config: Config;
    readonly imageViewer: ImageViewer;
    readonly emojiManager?: EmojiManager;
    readonly verifier?: ResponseVerifier;
}

export class Bot {
    private contextSize: number;    // 以对话形式给出的上下文长度

    private minTriggerCount: number;
    private maxTriggerCount: number;
    private allowErrorFormat: boolean;
    readonly finalFormat: "JSON" | "XML";

    private context: Message[] = []; // 对话上下文
    private recall: Message[] = [];  //
    private prompt: string;          // 系统提示词
    private toolList: ToolResult[] = [];

    private sendResolveOK: boolean;
    private sendAssistantMessageAs: "USER" | "ASSISTANT";
    private addRoleTagBeforeContent: boolean;

    private emojiManager: EmojiManager;
    readonly verifier: ResponseVerifier;
    readonly imageViewer: ImageViewer;
    readonly toolManager: ToolManager;

    private adapterSwitcher: AdapterSwitcher;
    public session: Session;
    private ctx: Context;


    constructor(private deps: Dependencies) {
        const { ctx, config } = this.deps;
        this.ctx = ctx;

        // 初始化配置
        this.sendResolveOK = config.Settings.SendResolveOK;
        this.sendAssistantMessageAs = config.Settings.SendAssistantMessageAs;
        this.addRoleTagBeforeContent = config.Settings.AddRoleTagBeforeContent
        this.contextSize = config.MemorySlot.SlotSize;
        this.minTriggerCount = Math.min(config.MemorySlot.MinTriggerCount, config.MemorySlot.MaxTriggerCount);
        this.maxTriggerCount = Math.max(config.MemorySlot.MinTriggerCount, config.MemorySlot.MaxTriggerCount);
        this.allowErrorFormat = config.Settings.AllowErrorFormat;

        this.adapterSwitcher = new AdapterSwitcher(
            config.API.APIList,
            config.Parameters
        );

        // 初始化依赖
        this.emojiManager = this.deps.emojiManager;
        this.verifier = this.deps.verifier;
        this.imageViewer = this.deps.imageViewer;
        this.toolManager = ToolManager.getInstance(ctx);

        this.finalFormat = this.adapterSwitcher.getAdapter().adapter.ability.includes("结构化输出") ? "JSON" : config.Settings.LLMResponseFormat;
    }

    setSystemPrompt(content: string) {
        this.prompt = content;
    }

    setSession(session: Session) {
        this.session = session;
    }

    addContext(message: Message) {
        while (this.context.length >= this.contextSize) {
            this.recall.push(this.context.shift());
        }
        this.context.push(message);
    }

    setChatHistory(chatHistory: Message[]) {
        this.context = [];
        let components: Array<TextPart | ImagePart> = [];
        chatHistory.forEach(message => {
            if (typeof message.content === 'string') {
                components.push(textPart(message.content));
            } else if (Array.isArray(message.content)) {
                const validComponents = message.content.filter((comp) => comp.type === 'text' || (comp.type === 'image_url' && 'image_url' in comp)) as Array<TextPart | ImagePart>;
                components.push(...validComponents);
            }
        });
        // 合并components中相邻的 TextComponent
        components = components.reduce((acc, curr, i) => {
            if (i === 0) return [curr];
            const prev = acc[acc.length - 1];
            if (prev.type === 'text' && curr.type === 'text') {
                prev.text += '\n' + (curr as TextPart).text;
                return acc;
            }
            return [...acc, curr];
        }, []);
        if (this.sendResolveOK) this.addContext(assistant("Resolve OK"));
        this.addContext(user(components));
        this.context = [];
        if (this.deps.config.Settings.MultiTurn) {
            for (const message of chatHistory) {
                this.addContext(message);
            }
        } else {
            let components: Array<TextPart | ImagePart> = [];
            chatHistory.forEach(message => {
                if (typeof message.content === 'string') {
                    components.push(textPart(message.content));
                } else if (Array.isArray(message.content)) {
                    const validComponents = message.content.filter((comp) => comp.type === 'text' || (comp.type === 'image_url' && 'image_url' in comp)) as Array<TextPart | ImagePart>;
                    components.push(...validComponents);
                }
            });
            // 合并components中相邻的 TextComponent
            components = components.reduce((acc, curr, i) => {
                if (i === 0) return [curr];
                const prev = acc[acc.length - 1];
                if (prev.type === 'text' && curr.type === 'text') {
                    prev.text += '\n' + (curr as TextPart).text;
                    return acc;
                }
                return [...acc, curr];
            }, []);
            this.addContext(user(components));
        }
    }

    getAdapter() {
        return this.adapterSwitcher.getAdapter();
    }

    async generateResponse(messages: Message[], debug = false): Promise<LLMResponse> {
        let { current, adapter } = this.getAdapter();

        if (!adapter) throw new Error("没有可用的适配器");

        for (const message of messages) this.addContext(message);

        this.toolList = await this.toolManager.getTools({ "session": this.session });

        // appendFunctionPrompt
        if (!adapter.ability.includes("原生工具调用")) {
            let str = this.toolList.map(tool => {
                let lines = [];
                lines.push(tool.function.name);
                lines.push(`  description: ${tool.function.description || "No description provided."}`);
                lines.push(`  params:`);
                Object.entries(tool.function.parameters).forEach(([key, value]) => {
                    lines.push(`    ${key}: ${value}`);
                })
                return lines.join("\n");
            })
                .join("\n");
            this.prompt = this.prompt.replace("{{functionPrompt}}", getFunctionSchema(this.finalFormat) + `${isEmpty(str) ? "No functions available." : str}`);
        }

        const { usage, text: content } = await adapter.chat([system(this.prompt), ...(this.sendResolveOK ? [assistant("Resolve OK")] : []), ...this.context], adapter.ability.includes("原生工具调用") ? this.toolList : undefined, debug);

        if (debug) this.ctx.logger.info(`Adapter: ${current}, Response: \n${content}`);

        // handle response
        let LLMResponse: any = {};

        if (this.finalFormat === "JSON") {
            const objs = extractJSONFromString(content, "object");
            for (const obj of objs) {
                if (obj && (obj as object)["status"]) {
                    LLMResponse = obj;
                    break;
                }
            }
            if (!LLMResponse || !LLMResponse["status"]) {
                const reason = `没有找到有效的 ${this.finalFormat} 结构: ${content}`;
                return {
                    status: "fail",
                    raw: content,
                    usage,
                    reason,
                    adapterIndex: current,
                }
            }
        } else if (this.finalFormat === "XML") {
            const regex = new RegExp(`\\\`\\\`\\\`(json|xml)\\s*\\n([\\s\\S]*?)\\n\\\`\\\`\\\`|({[\\s\\S]*?}|<[\\s\\S]*?>[\\s\\S]*<\\/[\\s\\S]*?>)`, 'gis');
            let contentToParse = null;
            let match;
            while ((match = regex.exec(content)) !== null) {
                const lang = match[1];
                const codeContent = match[2];
                const directContent = match[3];

                // 优先匹配与配置格式一致的代码块
                if (lang && lang.toUpperCase() === this.finalFormat) {
                    contentToParse = codeContent;
                    break; // 找到匹配的代码块，停止搜索
                }

                // 检查直接内容是否符合当前格式
                if (directContent && directContent.trim().startsWith('<')) {
                    contentToParse = directContent;
                    break; // 找到匹配的直接内容，停止搜索
                }
            }

            if (contentToParse) {
                try {
                    const parser = new XMLParser({
                        ignoreAttributes: false,
                        processEntities: false,
                        stopNodes: ['*.logic', '*.reply', '*.check', '*.finalReply'],
                    });
                    LLMResponse = parser.parse(contentToParse);
                    this.addContext(assistant(JSON.stringify(LLMResponse)));
                } catch (e) {
                    const reason = `${this.finalFormat} 解析失败。请上报此消息给开发者: ${e.message}`;
                    return {
                        status: "fail",
                        raw: content,
                        usage,
                        reason,
                        adapterIndex: current,
                    };
                }
            } else {
                // 未找到匹配内容，尝试直接解析或修复
                try {
                    const parser = new XMLParser({
                        ignoreAttributes: false,
                        processEntities: false,
                        stopNodes: ['*.logic', '*.reply', '*.check', '*.finalReply'],
                    });
                    LLMResponse = parser.parse(content);
                    this.addContext(assistant(JSON.stringify(LLMResponse)));
                } catch (err) {
                    const reason = `没有找到有效的 ${this.finalFormat} 结构: ${content}`;
                    return {
                        status: "fail",
                        raw: content,
                        usage,
                        reason,
                        adapterIndex: current,
                    };
                }
            }
        }

        let nextTriggerCount: number = Random.int(this.minTriggerCount, this.maxTriggerCount + 1); // 双闭区间
        // 规范化 nextTriggerCount，确保在设置的范围内
        const nextTriggerCountbyLLM = Math.max(this.minTriggerCount, Math.min(Number(LLMResponse.nextReplyIn) ?? this.minTriggerCount, this.maxTriggerCount));
        nextTriggerCount = Number(nextTriggerCountbyLLM) || nextTriggerCount;
        const finalLogic = LLMResponse.logic || "";

        let functions: Tool[] = [];
        if (Array.isArray(LLMResponse.functions)) {
            functions = LLMResponse.functions;
        } else if (isNotEmpty(LLMResponse.functions?.name)) {
            functions = [LLMResponse.functions];
        } else if (Array.isArray(LLMResponse.functions?.function)) {
            functions = LLMResponse.functions.function;
        } else if (isNotEmpty(LLMResponse.functions?.function?.name)) {
            functions = [LLMResponse.functions.function];
        }

        if (LLMResponse.status === "success") {
            let finalResponse: string = "";
            let unsafeResponse: any = LLMResponse.finalReply || LLMResponse.reply || "";

            finalResponse = unsafeResponse.toString();

            if (this.allowErrorFormat) {
                // 兼容弱智模型的错误回复
                finalResponse += LLMResponse.msg || LLMResponse.text || LLMResponse.message || LLMResponse.answer || "";
            }

            if (isEmpty(finalResponse)) {
                const reason = `回复内容为空`;
                this.ctx.logger.info(reason);
                return {
                    status: "skip",
                    raw: content,
                    usage,
                    nextTriggerCount,
                    functions,
                    logic: finalLogic,
                    adapterIndex: current,
                };
            }

            const replyTo = this.extractReplyTo(LLMResponse.replyTo);
            finalResponse = await this.unparseFaceMessage(finalResponse);

            return {
                status: "success",
                raw: content,
                finalReply: finalResponse,
                replyTo,
                nextTriggerCount,
                logic: finalLogic,
                functions,
                usage,
                adapterIndex: current,
            };
        } else if (LLMResponse.status === "skip") {
            return {
                status: "skip",
                raw: content,
                nextTriggerCount,
                logic: finalLogic,
                usage,
                functions,
                adapterIndex: current,
            };
        } else if (LLMResponse.status === "interaction") {
            return this.handleFunctionCalls(functions, debug);
        } else {
            const reason = `status 不是一个有效值: ${LLMResponse.status}`;
            return {
                status: "fail",
                raw: content,
                usage,
                reason,
                adapterIndex: current,
            };
        }
    }

    private async handleFunctionCalls(functionsToCall: Tool[], debug = false): Promise<LLMResponse | null> {
        if (debug) {
            this.ctx.logger.info(`Bot[${this.session.selfId}] 想要调用工具`)
            this.ctx.logger.info(toolsToString(functionsToCall));
        }
        let returns: Message[] = [];
        for (const func of functionsToCall) {
            const { name, params } = func;
            try {
                if (this.sendAssistantMessageAs === "USER") {
                    returns.push(user(this.addRoleTagBeforeContent ? "[assistant] " : "" + `CALLING FUNCTION: ${name} PARAMS: ${JSON.stringify(params)}`));
                    let returnValue = await this.callFunction(name, params);
                    if (!isEmpty(returnValue)) returns.push(user(this.addRoleTagBeforeContent ? "[tool] " : "" + `FUNCTION RESULT: ${returnValue}`));
                } else {
                    returns.push(assistant(this.addRoleTagBeforeContent ? "[assistant] " : "" + `CALLING FUNCTION: ${name} PARAMS: ${JSON.stringify(params)}`));
                    let returnValue = await this.callFunction(name, params);
                    if (!isEmpty(returnValue)) returns.push(assistant(this.addRoleTagBeforeContent ? "[tool] " : "" + `FUNCTION RESULT: ${returnValue}`));
                }
            } catch (e) {
                if (this.sendAssistantMessageAs === "USER") {
                    returns.push(user(this.addRoleTagBeforeContent ? "[tool] " : "" + `FUNCTION ERROR: ${e.message}`));
                }
                else {
                    returns.push(user(this.addRoleTagBeforeContent ? "[tool] " : "" + `FUNCTION ERROR: ${e.message}`));
                }
            }
        }
        if (returns.length > 0) {
            return this.generateResponse(returns, debug);
        }
        return null;
    }

    async callFunction(name: string, params: Record<string, any>): Promise<string> {
        let tool = this.toolList.find(tool => tool.function.name === name);
        if (!tool) {
            throw new Error(`Tool ${name} not found`);
        }
        //@ts-ignore
        let result = await tool.execute(params);
        return result as string;
    }

    // 如果 replyTo 不是私聊会话，只保留数字部分
    private extractReplyTo(replyTo: string): string {
        try {
            replyTo = replyTo.toString().trim();
            if (isNotEmpty(replyTo) && !replyTo.startsWith("private:")) {
                const numericMatch = replyTo.match(/\d+/);
                if (numericMatch) {
                    replyTo = numericMatch[0].replace(/\s/g, "");
                }
                // 不合法的 channelId
                if (replyTo.match(/\{.+\}/)) {
                    replyTo = "";
                }
                if (replyTo.indexOf("sandbox") > -1) {
                    replyTo = "";
                }
            }
            return replyTo;
        } catch (e) {
            return "";
        }
    }

    async unparseFaceMessage(message: string) {
        message = message.toString();
        // 反转义 <face> 消息
        const faceRegex = /\[表情[:：]\s*([^\]]+)\]/g;
        const matches = Array.from(message.matchAll(faceRegex));

        const replacements = await Promise.all(
            matches.map(async (match) => {
                const name = match[1];
                let id = await this.emojiManager.getIdByName(name);
                if (!id) {
                    id = (await this.emojiManager.getIdByName(await this.emojiManager.getNameByTextSimilarity(name))) || "500";
                }
                return {
                    match: match[0],
                    replacement: `<face id="${id}" name="${(await this.emojiManager.getNameById(id)) || undefined}"></face>`,
                };
            })
        );
        replacements.forEach(({ match, replacement }) => {
            message = message.replace(match, replacement);
        });
        return message;
    }
}
