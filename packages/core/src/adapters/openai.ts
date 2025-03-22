import { Config } from "../config";
import { sendRequest, sendStreamRequest } from "../utils/http";
import { BaseAdapter, Response } from "./base";
import { LLM } from "./config";
import { Message } from "./creators/component";
import { ToolSchema } from "./creators/schema";

export class OpenAIAdapter extends BaseAdapter {
  constructor(config: LLM, parameters?: Config["Parameters"]) {
    super(config, parameters);
    this.url = `${config.BaseURL}/v1/chat/completions`;
  }

  async chat(messages: Message[], toolsSchema?: ToolSchema[], debug = false): Promise<Response> {
    if (this.ability.includes("对话前缀续写") && this.startWith) {
      messages.push({ "role": "assistant", "content": this.startWith, "prefix": true })
    }
    const requestBody: any = {
      model: this.model,
      reasoning_effort: this.ability.includes("深度思考") ? this.reasoningEffort : undefined,
      messages,
      ...(toolsSchema ? { tools: toolsSchema } : {}),
      temperature: this.parameters?.Temperature,
      max_tokens: this.parameters?.MaxTokens,
      top_p: this.parameters?.TopP,
      frequency_penalty: this.parameters?.FrequencyPenalty,
      presence_penalty: this.parameters?.PresencePenalty,
      stop: this.parameters?.Stop,
      response_format: this.ability.includes("结构化输出")
        ? { type: "json_object" }
        : undefined,
      ...this.otherParams,
    };
    let response: any = {};

    if (this.ability.includes("流式输出")) {
      requestBody["stream"] = true;
      let fullContent = '';
      let currentLineBuffer = "";
      await sendStreamRequest(this.url, this.apiKey, requestBody, this.adapterConfig.Timeout, (chunk) => {
        let data = JSON.parse(chunk);
        if (data.choices[0].finish_reason !== "stop") {
          let delta = data.choices[0].delta.reasoning_content || data.choices[0].delta.content || "";
          fullContent += delta;
          currentLineBuffer += delta;

          if (currentLineBuffer.includes("\n")) {
            // 清除当前行并将光标移动到行首
            process.stdout.write('\x1B[K\r');
            // 输出新的文本
            process.stdout.write(currentLineBuffer);

            // 重置当前行缓冲区
            currentLineBuffer = "";
          }
        } else {
          response = data;
          response.choices[0].message = {
            role: "assistant",
            content: fullContent,
          };
          process.stdout.write("\n");
        }
      }, debug);
    } else {
      response = await sendRequest(this.url, this.apiKey, requestBody, this.adapterConfig.Timeout, debug);
    }

    try {
      return {
        model: response.model,
        created: response.created,
        message: {
          role: response.choices[0].message.role,
          content: response.choices[0].message.content,
          tool_calls: response.choices[0].message.tool_calls,
        },
        usage: response.usage,
      };
    } catch (error) {
      console.error("Error parsing response:", error);
      console.error("Response:", response);
    }
  }
}
