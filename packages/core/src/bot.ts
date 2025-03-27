import { XMLParser } from "fast-xml-parser";
import { jsonrepair } from 'jsonrepair';
import { Context, Random, Session } from "koishi";

import { AdapterSwitcher } from "./adapters";
import { AssistantMessage, ImageComponent, Message, SystemMessage, TextComponent, ToolCall, ToolMessage, UserMessage } from "./adapters/creators/component";
import { getFunctionSchema, ToolSchema } from "./adapters/creators/schema";
import { Config } from "./config";
import { Extension, getExtensions, getFunctionPrompt, getToolSchema } from "./extensions/base";
import { EmojiManager } from "./managers/emojiManager";
import { LLMResponse, Tool } from "./models/LLMResponse";
import { ImageViewer } from "./services/imageViewer";
import { toolsToString } from "./utils";
import { isEmpty, isNotEmpty, Template } from "./utils/string";
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
    private template: Template;

    private sendResolveOK: boolean;

    private extensions: { [key: string]: Extension & Function } = {};
    private toolsSchema: ToolSchema[] = [];

    private emojiManager: EmojiManager;
    readonly verifier: ResponseVerifier;
    readonly imageViewer: ImageViewer;

    private adapterSwitcher: AdapterSwitcher;
    public session: Session;
    private ctx: Context;

    constructor(private deps: Dependencies) {
        const { ctx, config } = this.deps;
        this.ctx = ctx;
        this.sendResolveOK = config.Settings.SendResolveOK;
        this.contextSize = config.MemorySlot.SlotSize;
        this.minTriggerCount = Math.min(config.MemorySlot.MinTriggerCount, config.MemorySlot.MaxTriggerCount);
        this.maxTriggerCount = Math.max(config.MemorySlot.MinTriggerCount, config.MemorySlot.MaxTriggerCount);
        this.allowErrorFormat = config.Settings.AllowErrorFormat;
        this.adapterSwitcher = new AdapterSwitcher(
            config.API.APIList,
            config.Parameters
        );
        this.template = new Template(config.Settings.SingleMessageStrctureTemplate, /\{\{(\w+(?:\.\w+)*)\}\}/g, /\{\{(\w+(?:\.\w+)*),([^,]*),([^}]*)\}\}/g);
        this.emojiManager = this.deps.emojiManager;
        this.verifier = this.deps.verifier;
        this.imageViewer = this.deps.imageViewer;

        for (const extension of getExtensions(ctx, this)) {
            this.extensions[extension.name] = extension as any;
            this.toolsSchema.push(getToolSchema(extension));
        }
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
      if (this.deps.config.Settings.MultiTurn) {
          for (const message of chatHistory) {
              this.addContext(message);
          }
      } else {
          let components: (TextComponent | ImageComponent)[] = [];
          chatHistory.forEach(message => {
              if (typeof message.content === 'string') {
                  components.push(TextComponent(message.content));
              } else if (Array.isArray(message.content)) {
                  const validComponents = message.content.filter((comp): comp is TextComponent | ImageComponent =>
                      comp.type === 'text' || (comp.type === 'image_url' && 'image_url' in comp));
                  components.push(...validComponents);
              }
          });
          // 合并components中相邻的 TextComponent
          components = components.reduce((acc, curr, i) => {
              if (i === 0) return [curr];
              const prev = acc[acc.length - 1];
              if (prev.type === 'text' && curr.type === 'text') {
                  prev.text += '\n' + (curr as TextComponent).text;
                  return acc;
              }
              return [...acc, curr];
          }, []);
          this.addContext(UserMessage(...components));
      }
    }

    getAdapter() {
        return this.adapterSwitcher.getAdapter();
    }

    async generateResponse(messages: Message[], debug = false): Promise<LLMResponse> {
        let { current, adapter } = this.getAdapter();

        if (!adapter) throw new Error("没有可用的适配器");

        for (const message of messages) this.addContext(message);

        if (!adapter.ability.includes("原生工具调用")) {
            // appendFunctionPrompt
            let str = Object.values(this.extensions)
                .map((extension) => getFunctionPrompt(extension))
                .join("\n");
            this.prompt = this.prompt.replace("{{functionPrompt}}", getFunctionSchema(this.finalFormat) + `${isEmpty(str) ? "No functions available." : str}`);
        }

        const response = await adapter.chat([SystemMessage(this.prompt), ...(this.sendResolveOK ? [AssistantMessage("Resolve OK")] : []), ...this.context], adapter.ability.includes("原生工具调用") ? this.toolsSchema : undefined, debug);
        let content = response.message.content;
        if (adapter.ability.includes("深度思考")) {
            // 移除adapter.reasoningStart和adapter.reasoningEnd之间的内容
            // adapter.reasoningStart和adapter.reasoningEnd本身也可能是正则表达式，例如adapter.reasoningEnd可能是Reasoned for (?:a second|[^\n]* seconds)
            const contentWithoutReasoning = content.replace(
                new RegExp(`${adapter.reasoningStart}[\\s\\S]*?${adapter.reasoningEnd}`, 'g'),
                ''
            );

            content = contentWithoutReasoning.trim();
        }
        if (debug) this.ctx.logger.info(`Adapter: ${current}, Response: \n${content}`);

        if (adapter.ability.includes("原生工具调用")) {
            const toolResponse = await this.handleToolCalls(response.message.tool_calls || [], debug);
            if (toolResponse) return toolResponse;
        }

        // handle response
        let LLMResponse: any = {};
        const regex = new RegExp(`\\\`\\\`\\\`(json|xml)\\s*\\n([\\s\\S]*?)\\n\\\`\\\`\\\`|({[\\s\\S]*?}|<[\\s\\S]*?>[\\s\\S]*<\\/[\\s\\S]*?>)`,'gis');
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
            if (directContent) {
                if (
                    (this.finalFormat === 'JSON' && directContent.trim().startsWith('{')) ||
                    (this.finalFormat === 'XML' && directContent.trim().startsWith('<'))
                ) {
                    contentToParse = directContent;
                    break; // 找到匹配的直接内容，停止搜索
                }
            }
        }

        if (contentToParse) {
            try {
                if (this.finalFormat === "JSON") {
                    LLMResponse = JSON.parse(jsonrepair(contentToParse));
                } else if (this.finalFormat === "XML") {
                    const parser = new XMLParser({
                      ignoreAttributes: false,
                      processEntities: false,
                      stopNodes: ['*.logic', '*.reply', '*.check', '*.finalReply'],
                    });
                    LLMResponse = parser.parse(contentToParse);
                }
                this.addContext(AssistantMessage(JSON.stringify(LLMResponse)));
            } catch (e) {
                const reason = `${this.finalFormat} 解析失败。请上报此消息给开发者: ${e.message}`;
                return {
                    status: "fail",
                    raw: content,
                    usage: response.usage,
                    reason,
                    adapterIndex: current,
                };
            }
        } else {
            // 未找到匹配内容，尝试直接解析或修复
            try {
                if (this.finalFormat === "JSON") {
                    const repaired = jsonrepair(content);
                    LLMResponse = JSON.parse(repaired);
                } else {
                    const parser = new XMLParser({
                      ignoreAttributes: false,
                      processEntities: false,
                      stopNodes: ['*.logic', '*.reply', '*.check', '*.finalReply'],
                    });
                    LLMResponse = parser.parse(content);
                }
                this.addContext(AssistantMessage(JSON.stringify(LLMResponse)));
            } catch (err) {
                const reason = `没有找到有效的 ${this.finalFormat} 结构: ${content}`;
                return {
                    status: "fail",
                    raw: content,
                    usage: response.usage,
                    reason,
                    adapterIndex: current,
                };
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
                    usage: response.usage,
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
                usage: response.usage,
                adapterIndex: current,
            };
        } else if (LLMResponse.status === "skip") {
            return {
                status: "skip",
                raw: content,
                nextTriggerCount,
                logic: finalLogic,
                usage: response.usage,
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
                usage: response.usage,
                reason,
                adapterIndex: current,
            };
        }
    }

    // 或许可以将这两个函数整合到一起
    // 递归调用
    // TODO: 指定最大调用深度
    // TODO: 上报函数调用信息
    private async handleToolCalls(toolCalls: ToolCall[], debug: boolean): Promise<LLMResponse | null> {
        if (debug) {
            this.ctx.logger.info(`Bot[${this.session.selfId}] 想要调用工具`)
            this.ctx.logger.info(toolCalls.map(toolCall => `Name: ${toolCall.function.name}\nArgs: ${JSON.stringify(toolCall.function.arguments)})}`).join('\n'));
        }
        let returns: ToolMessage[] = [];
        for (let toolCall of toolCalls) {
            try {
                let result = await this.callFunction(toolCall.function.name, toolCall.function.arguments);
                if (!isEmpty(result)) returns.push(ToolMessage(result, toolCall.id));
            } catch (e) {
                returns.push(ToolMessage(e.message, toolCall.id));
            }
        }
        if (returns.length > 0) {
            return this.generateResponse(returns, debug);
        }
        return null;
    }

    private async handleFunctionCalls(functions: Tool[], debug: boolean): Promise<LLMResponse | null> {
        if (debug) {
            this.ctx.logger.info(`Bot[${this.session.selfId}] 想要调用工具`)
            this.ctx.logger.info(toolsToString(functions));
        }
        let returns: Message[] = [];
        for (const func of functions) {
            const { name, params } = func;
            try {
                returns.push(UserMessage(`[assistant] CALLING FUNCTION: ${name} PARAMS: ${JSON.stringify(params)}`));
                let returnValue = await this.callFunction(name, params);
                if (!isEmpty(returnValue)) returns.push(UserMessage(`[tool_call] FUNCTION RESULT: ${returnValue}`));
            } catch (e) {
                returns.push(UserMessage(`[tool_call] FUNCTION ERROR: ${e.message}`));
            }
        }
        if (returns.length > 0) {
            return this.generateResponse(returns, debug);
        }
        return null;
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

    // TODO: 规范化params
    // OpenAI和Ollama提供的参数不一致
    async callFunction(name: string, params: Record<string, any>): Promise<any> {
        let func = this.extensions[name] as Function;
        if (!func) {
            throw new Error(`Function not found: ${name}`);
        }

        return await func(params);
    }

    getMemory(selfId: string) {
        // @ts-ignore
        if (this.ctx.memory) return this.ctx.memory.MEMORY_PROMPT
        return "";
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

    private collectUserID() {
        const users: Map<string, string> = new Map();
        const stringTemplate = this.template;

        for (const history of this.context) {
            let content = history.content;
            switch (typeof content) {
                case "string":
                    break;
                case "object":
                    content = (history.content as (TextComponent | ImageComponent)[])
                        .filter((comp): comp is TextComponent => comp.type === 'text')
                        .map(comp => comp.text)
                        .join('');
                    break;
                default:
                    content = "";
                    break;
            }
            const result = stringTemplate.unrender(content);

            if (result.senderId && result.senderName) {
                users.set(result.senderId, result.senderName);
            }
        }

        return users;
    }
}
