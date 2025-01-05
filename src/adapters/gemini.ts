import axios from "axios";
import { Config } from "../config";
import { foldText, getMimeTypeFromBase64, sendRequest } from "../utils";
import { BaseAdapter, Response } from "./base";
import { LLM } from "./config";
import { Message } from "./creators/component";
import { ToolSchema } from "./creators/schema";

interface Content {
  role: string;
  parts: Part[];
}

export type Part = TextPart | InlineDataPart;
// | FunctionCallPart
// | FunctionResponsePart
// | FileDataPart
// | ExecutableCodePart
// | CodeExecutionResultPart;

interface TextPart {
  text: string;
  inlineData?: never;
  functionCall?: never;
  functionResponse?: never;
  fileData?: never;
  executableCode?: never;
  codeExecutionResult?: never;
}

interface InlineDataPart {
  mime_type: string;
  data: string;
}

interface GenerateContentResponse {
  candidates?: GenerateContentCandidate[];
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
    cachedContentTokenCount?: number;
  };
  modelVersion?: string;
}

export interface GenerateContentCandidate {
  index: number;
  content: Content;
  finishMessage?: string;
}

export class GeminiAdapter extends BaseAdapter {
  constructor(config: LLM, parameters?: Config["Parameters"]) {
    super(config, parameters);
    // base url: https://generativelanguage.googleapis.com
    if (config.BaseURL.endsWith("/")) {
      config.BaseURL = config.BaseURL.slice(0, -1);
    }
    this.url = `${config.BaseURL}/v1beta/models/${config.AIModel}:generateContent?key=${config.APIKey}`;
  }

  async chat(messages: Message[], toolsSchema?: ToolSchema[], debug = false): Promise<Response> {
    const system = messages.find((message) => message.role === "system");
    if (system) {
      messages = messages.filter((message) => message.role !== "system");

    }
    const requestBody = {
      system_instruction: convert(system),
      contents: messages.map(convert),
      generationConfig: {
        stopSequences: this.parameters?.Stop,
        temperature: this.parameters?.Temperature,
        maxOutputTokens: this.parameters?.MaxTokens,
        topP: this.parameters?.TopP,
        response_mime_type: this.ability.includes("结构化输出")
          ? "application/json"
          : undefined,
      },
    };

    let response = await sendRequest<GenerateContentResponse>(this.url, "", requestBody, debug);
    try {
      return {
        model: response.modelVersion,
        created: Date.now().toLocaleString(),
        message: {
          role: "assistant",
          // @ts-ignore
          content: response.candidates[0].content.parts.map((part) => part.text).join(""),
        },
        usage: {
          prompt_tokens: response.usageMetadata.promptTokenCount,
          completion_tokens: response.usageMetadata.candidatesTokenCount,
          total_tokens: response.usageMetadata.totalTokenCount,
        },
      };
    } catch (error) {
      console.error("Error parsing response:", error);
      console.error("Response:", response);
    }
  }
}

function convert(message: Message): Content {
  // @ts-ignore
  message.role = message.role == "assistant" ? "model" : message.role;
  if (typeof message.content === "string") {
    return {
      role: message.role,
      parts: [{ text: message.content }],
    };
  }

  return {
    role: message.role,
    parts: message.content.map((component) => {
      if (typeof component === "string") {
        return { text: component };
      } else if (component.type === "image_url") {
        return {
          mime_type: getMimeTypeFromBase64(component["image_url"]["url"]),
          data: component["image_url"]["url"],
        };
      } else if (component.type === "text") {
        return { text: component["text"] };
      }
    }),
  };
}
