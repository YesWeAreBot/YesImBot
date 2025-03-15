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
    const requestBody: any = {
      model: this.model,
      reasoning_effort: this.ability.includes("深度思考") ? this.reasoningEffort : undefined,
      messages,
      ...(toolsSchema ? { tools: toolsSchema } : {}),
      temperature: this.parameters?.Temperature,
      max_tokens: this.parameters?.MaxTokens,
      frequency_penalty: this.parameters?.FrequencyPenalty,
      presence_penalty: this.parameters?.PresencePenalty,
      response_format: this.ability.includes("结构化输出")
        ? { type: "json_object" }
        : undefined,
      ...this.otherParams,
    };
    let response: any = {};

    if (this.ability.includes("流式输出")) {
      requestBody["stream"] = true;
      let fullContent = '';
      await sendStreamRequest(this.url, this.apiKey, requestBody, this.adapterConfig.Timeout, (chunk) => {
        let data = JSON.parse(chunk);
        if (data.choices[0].finish_reason !== "stop") {
          fullContent += data.choices[0].delta.reasoning_content || data.choices[0].delta.content || "";
          process.stdout.write(`\x1B[K\r${fullContent}`); // \x1B[K 清除整行，\r 回到行首
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
