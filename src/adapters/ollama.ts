import { Config } from "../config";
import { sendRequest } from "../utils/http";
import { BaseAdapter, Response } from "./base";
import { LLM } from "./config";
import { Message } from "./creators/component";
import { ToolSchema } from "./creators/schema";

interface ToolCall {
  function: {
    name: string;
    arguments: {
      [key: string]: any;
    }
  }
}

interface ToolMessage {
  role: "tool";
  content: string;
}

function ToolMessage(content: string): ToolMessage {
  return {
    role: "tool",
    content
  }
}

export class OllamaAdapter extends BaseAdapter {
  private config: LLM;
  constructor(config: LLM, parameters?: Config["Parameters"]) {
    super(config, parameters);
    this.url = `${config.BaseURL}/api/chat`;
    this.config = config;
  }

  async chat(messages: Message[], toolsSchema?: ToolSchema[], debug = false): Promise<Response> {
    for (const message of messages) {
      let content = "";
      for (const component of message.content) {
        if (typeof component === "string"){
          content += component;
        } else if (component.type === "image_url") {
          if (!message["images"]) message["images"] = [];
          message["images"].push(component["image_url"]["url"]);
        } else if (component.type === "text") {
          content += component["text"];
        }
      }
      message["content"] = content;
    }
    const requestBody = {
      model: this.model,
      stream: false,
      format: this.ability.includes("结构化输出") ? "json" : undefined,
      messages,
      tools: toolsSchema,
      options: {
        numa: this.config.NUMA,
        num_ctx: this.config.NumCtx,
        num_batch: this.config.NumBatch,
        num_gpu: this.config.NumGPU,
        main_gpu: this.config.MainGPU,
        low_vram: this.config.LowVRAM,
        logits_all: this.config.LogitsAll,
        vocab_only: this.config.VocabOnly,
        use_mmap: this.config.UseMMap,
        use_mlock: this.config.UseMLock,
        num_thread: this.config.NumThread,
        // 以上是加载模型时要用到的参数
        // 以下是推理时要用到的参数
        num_predict: this.parameters?.MaxTokens,
        temperature: this.parameters?.Temperature,
        top_p: this.parameters?.TopP,
        presence_penalty: this.parameters?.PresencePenalty,
        frequency_penalty: this.parameters?.FrequencyPenalty,
        stop: this.parameters?.Stop,
        ...this.otherParams,
      },
    };
    let response = await sendRequest(this.url, this.apiKey, requestBody, debug);

    try {
      return {
        model: response.model,
        created: response.created_at,
        message: {
          role: response.message.role,
          content: response.message.content,
          tool_calls: response.message.tool_calls,
        },
        usage: {
          prompt_tokens: response.prompt_eval_count,
          completion_tokens: response.eval_count,
          total_tokens: response.prompt_eval_count + response.eval_count,
        },
      };
    } catch (error) {
      console.error("Error parsing response:", error);
      console.error("Response:", response);
    }
  }
}
