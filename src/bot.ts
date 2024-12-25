import { Context, Random, Session } from "koishi";

import { AdapterSwitcher } from "./adapters";
import { Usage } from "./adapters/base";
import { AssistantMessage, ImageComponent, Message, SystemMessage, TextComponent, ToolCall, ToolMessage, UserMessage } from "./adapters/creators/component";
import { functionPrompt, ToolSchema } from "./adapters/creators/schema";
import { Config } from "./config";
import { EmbeddingsBase } from "./embeddings/base";
import { Extension, getExtensions, getFunctionPrompt, getToolSchema } from "./extensions/base";
import { EmojiManager } from "./managers/emojiManager";
import { Memory } from "./memory/memory";
import { ImageViewer } from "./services/imageViewer";
import { getEmbedding } from "./utils/factory";
import { escapeUnicodeCharacters, isEmpty, Template } from "./utils/string";
import { getFormatDateTime, tiktokenizer } from "./utils/toolkit";
import { ResponseVerifier } from "./utils/verifier";

export interface Function {
  name: string;
  params: Record<string, any>;
}

export interface SuccessResponse {
  status: "success";
  raw: string;
  finalReply: string;
  replyTo?: string;
  quote?: string;
  nextTriggerCount: number;
  logic: string;
  functions: Array<Function>;
  usage: Usage;
  adapterIndex: number;
}

export interface SkipResponse {
  status: "skip";
  raw: string;
  nextTriggerCount: number;
  logic: string;
  functions: Array<Function>;
  usage: Usage;
  adapterIndex: number;
}

export interface FailedResponse {
  status: "fail";
  raw: string;
  reason: string;
  usage: Usage;
  adapterIndex: number;
}

type Response = SuccessResponse | SkipResponse | FailedResponse;

export class Bot {
  readonly memory: Memory;
  private memorySize: number;

  private summarySize: number;         // 上下文达到多少时进行总结
  private contextSize: number = 20;    // 以对话形式给出的上下文长度
  private retainedContextSize: number; // 进行总结时保留的上下文长度，用于保持记忆连贯性
  private maxSelfMemoryCharacters: 5000; //

  private minTriggerCount: number;
  private maxTriggerCount: number;
  private allowErrorFormat: boolean;

  private context: Message[] = []; // 对话上下文
  private recall: Message[] = [];  //
  private prompt: string;          // 系统提示词
  private template: Template;
  private extensions: { [key: string]: Extension & Function } = {};
  private toolsSchema: ToolSchema[] = [];
  private lastModified: Date = new Date();

  private emojiManager: EmojiManager;
  private embedder: EmbeddingsBase;
  readonly verifier: ResponseVerifier;
  readonly imageViewer: ImageViewer;

  private adapterSwitcher: AdapterSwitcher;
  public session: Session;

  constructor(private ctx: Context, private config: Config) {
    this.minTriggerCount = Math.min(config.MemorySlot.MinTriggerCount, config.MemorySlot.MaxTriggerCount);
    this.maxTriggerCount = Math.max(config.MemorySlot.MinTriggerCount, config.MemorySlot.MaxTriggerCount);
    this.allowErrorFormat = config.Settings.AllowErrorFormat;
    this.adapterSwitcher = new AdapterSwitcher(
      config.API.APIList,
      config.Parameters
    );
    if (config.Embedding.Enabled) {
      this.emojiManager = new EmojiManager(config.Embedding);
      this.embedder = getEmbedding(config.Embedding);
      this.memory = new Memory(ctx, config.API.APIList[0], config.Embedding, config.Parameters);
    };
    if (config.Verifier.Enabled) this.verifier = new ResponseVerifier(config);

    this.template = new Template(config.Settings.SingleMessageStrctureTemplate, /\{\{(\w+(?:\.\w+)*)\}\}/g, /\{\{(\w+(?:\.\w+)*),([^,]*),([^}]*)\}\}/g);

    this.imageViewer = new ImageViewer(config);

    for (const extension of getExtensions(ctx, this)) {
      this.extensions[extension.name] = extension;
      this.toolsSchema.push(getToolSchema(extension));
    }
  }

  updateConfig(config: Config) {
    this.config = config;
    this.adapterSwitcher.updateConfig(config.API.APIList, config.Parameters);
  }

  setSystemPrompt(content: string) {
    this.prompt = content;
  }

  setSession(session: Session) {
    this.session = session;
  }

  /**
   *
   * @TODO 对旧记忆进行总结
   * @param message The message to add to the context.
   */
  addContext(message: Message) {
    while (this.context.length >= this.contextSize) {
      this.recall.push(this.context.shift());
    }
    this.context.push(message);
  }

  setChatHistory(chatHistory: Message[]) {
    this.context = [];
    if (this.config.Settings.MultiTurn) {
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
      this.addContext(AssistantMessage("Resolve OK"));
      this.addContext(UserMessage(...components));
    }
  }

  getAdapter() {
    return this.adapterSwitcher.getAdapter();
  }

  async generateResponse(messages: Message[], debug = false): Promise<Response> {
    let { current, adapter } = this.getAdapter();

    if (!adapter) {
      throw new Error("没有可用的适配器");
    }

    for (const message of messages) {
      this.addContext(message);
    }

    if (!adapter.ability.includes("原生工具调用")) {
      // appendFunctionPrompt
      let str = Object.values(this.extensions)
        .map((extension) => getFunctionPrompt(extension))
        .join("\n");
      this.prompt += functionPrompt + `${isEmpty(str) ? "No functions available." : str}`;
    }

    const response = await adapter.chat([SystemMessage(this.prompt), ...this.context], adapter.ability.includes("原生工具调用") ? this.toolsSchema : undefined, debug);
    let content = response.message.content;
    if (debug) logger.info(`Adapter: ${current}, Response: \n${content}`);

    if (adapter.ability.includes("原生工具调用")) {
      const toolResponse = await this.handleToolCalls(response.message.tool_calls || [], debug);
      if (toolResponse) return toolResponse;
    }

    if (this.config.Settings.MultiTurn && this.config.Settings.MultiTurnFormat === "CUSTOM") {
      return this.handleCustomMultiTurnResponse(content, response, current, debug);
    }

    return this.handleJsonResponse(content, response, current, debug);
  }

  // 或许可以将这两个函数整合到一起
  // 递归调用
  // TODO: 指定最大调用深度
  // TODO: 上报函数调用信息
  private async handleToolCalls(toolCalls: ToolCall[], debug: boolean): Promise<Response | null> {
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

  private async handleFunctionCalls(functions: Function[], debug: boolean): Promise<Response | null> {
    const Success = (func: string, message: string) => {
      return ToolMessage(JSON.stringify({ function: func, status: "success", result: message }), null);
    }
    const Failed = (func: string,  message: string) => {
      return ToolMessage(JSON.stringify({ function: func, status: "failed", reason: message }), null);
    }
    let returns: Message[] = [];
    for (const func of functions) {
      const { name, params } = func;
      try {
        let returnValue = await this.callFunction(name, params);
        if (!isEmpty(returnValue)) returns.push(Success(name, returnValue));
      } catch (e) {
        returns.push(Failed(name, e.message));
      }
    }
    if (returns.length > 0) {
      return this.generateResponse(returns, debug);
    }
    return null;
  }

  private async handleCustomMultiTurnResponse(content: string, response: any, current: number, debug: boolean): Promise<Response> {
    this.addContext(AssistantMessage(TextComponent(content)));
    const result = this.template.unrender(content);
    const channelIdfromChannelInfo = result.channelInfo?.includes(':') ? result.channelInfo.split(':')[1] : '';
    const channelId = result.channelId || channelIdfromChannelInfo;

    if (result.userContent === undefined || !channelId) {
      return {
        status: "fail",
        raw: content,
        usage: response.usage,
        reason: "解析失败",
        adapterIndex: current,
      };
    } else {
      const finalResponse = result.userContent.trim();
      if (finalResponse === "") {
        return {
          status: "skip",
          raw: content,
          nextTriggerCount: Random.int(this.minTriggerCount, this.maxTriggerCount + 1),
          logic: "",
          usage: response.usage,
          functions: [],
          adapterIndex: current,
        };
      } else {
        return {
          status: "success",
          raw: content,
          finalReply: await this.unparseFaceMessage(finalResponse),
          replyTo: channelId,
          quote: result.quoteMessageId || "",
          nextTriggerCount: Random.int(this.minTriggerCount, this.maxTriggerCount + 1),
          logic: "",
          functions: [],
          usage: response.usage,
          adapterIndex: current,
        };
      }
    }
  }

  private async handleJsonResponse(content: string, response: any, current: number, debug: boolean): Promise<Response> {
    if (typeof content !== "string") {
      content = JSON.stringify(content, null, 2);
    }

    const jsonMatch = content.match(/{.*}/s);
    let LLMResponse: any = {};

    if (jsonMatch) {
      try {
        LLMResponse = JSON.parse(escapeUnicodeCharacters(jsonMatch[0]));
        this.addContext(AssistantMessage(JSON.stringify(LLMResponse)));
      } catch (e) {
        const reason = `JSON 解析失败。请上报此消息给开发者: ${e.message}`;
        if (debug) logger.warn(reason);
        return {
          status: "fail",
          raw: content,
          usage: response.usage,
          reason,
          adapterIndex: current,
        };
      }
    } else {
      const reason = `没有找到 JSON: ${content}`;
      if (debug) logger.warn(reason);
      return {
        status: "fail",
        raw: content,
        usage: response.usage,
        reason,
        adapterIndex: current,
      };
    }

    let nextTriggerCount: number = Random.int(this.minTriggerCount, this.maxTriggerCount + 1); // 双闭区间
    // 规范化 nextTriggerCount，确保在设置的范围内
    const nextTriggerCountbyLLM = Math.max(this.minTriggerCount, Math.min(Number(LLMResponse.nextReplyIn) ?? this.minTriggerCount, this.maxTriggerCount));
    nextTriggerCount = Number(nextTriggerCountbyLLM) || nextTriggerCount;
    const finalLogic = LLMResponse.logic || "";
    const functions = Array.isArray(LLMResponse.functions) ? LLMResponse.functions : [];

    if (LLMResponse.status === "success") {
      let finalResponse = LLMResponse.finalReply || LLMResponse.reply || "";
      if (this.allowErrorFormat) {
        // 兼容弱智模型的错误回复
        finalResponse += LLMResponse.msg || LLMResponse.text || LLMResponse.message || LLMResponse.answer || "";
      }

      if (isEmpty(finalResponse)) {
        const reason = `回复为空: ${content}`;
        if (debug) logger.warn(reason);
        return {
          status: "fail",
          raw: content,
          usage: response.usage,
          reason,
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
        quote: LLMResponse.quote || "",
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
    } else if (LLMResponse.status === "function") {
      return this.handleFunctionCalls(LLMResponse.functions, debug);
    } else {
      const reason = `status 不是一个有效值: ${content}`;
      if (debug) logger.warn(reason);
      return {
        status: "fail",
        raw: content,
        usage: response.usage,
        reason,
        adapterIndex: current,
      };
    }
  }

  // 如果 replyTo 不是私聊会话，只保留数字部分
  private extractReplyTo(replyTo: string): string {
    if (replyTo && !replyTo.startsWith("private:")) {
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
  }

  async summarize(channelId, userId, content) { }

  // TODO: 规范化params
  // OpenAI和Ollama提供的参数不一致
  async callFunction(name: string, params: Record<string, any>): Promise<any> {

    let func = this.extensions[name];
    const args = Object.values(params || {});
    if (!func) {
      throw new Error(`Function not found: ${name}`);
    }

    // @ts-ignore
    return await func(...args);
  }

  async getCoreMemory(selfId: string): Promise<string> {
    const recallSize = 0;
    const archivalSize = 0;

    let selfMemory = this.memory.filterMemory(metadata => {
      return metadata.userId === selfId || !metadata.userId;
    }).join("\n");

    const userIds = this.collectUserID();
    const humanMemories = Array.from(userIds.entries()).map(([userId, nickname]) => `
      <user id="${userId}" nickname="${nickname}">
      ${this.memory.getUserMemory(userId).join("\n")}
      </user>`
    );

    return `### Memory [last modified: ${getFormatDateTime(this.lastModified)}]
${recallSize} previous messages between you and the user are stored in recall memory (use functions to access them)
${archivalSize} total memories you created are stored in archival memory (use functions to access them)

Core memory shown below (limited in size, additional information stored in archival / recall memory):

<selfMemory character="${tiktokenizer(selfMemory)}/${this.maxSelfMemoryCharacters}">
${selfMemory}
</selfMemory>

${humanMemories.join("\n")}
`.trim();
  }

  async unparseFaceMessage(message: string) {
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
