import { Config } from "../config";
import { sendRequest } from "../utils/http";
import { BaseAdapter, Response } from "./base";
import { LLM } from "./config";
import { Message, ToolCall, ToolMessage } from "./creators/component";
import { ToolSchema } from "./creators/schema";

export class CustomAdapter extends BaseAdapter {
  constructor(config: LLM, parameters?: Config["Parameters"]) {
    super(config, parameters);
    this.url = config.BaseURL;
  }

  async chat(messages: Message[], toolsSchema?: ToolSchema[], debug = false): Promise<Response> {
    if (this.ability.includes("对话前缀续写") && this.startWith) {
      messages.push({"role": "assistant", "content": this.startWith, "prefix": true})
    }
    const requestBody = {
      model: this.model,
      reasoning_effort: this.ability.includes("深度思考") ? this.reasoningEffort : undefined,
      messages,
      toolsSchema,
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
    let response = await sendRequest(this.url, this.apiKey, requestBody, this.adapterConfig.Timeout, debug);

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
