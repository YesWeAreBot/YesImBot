import { createAnthropic, AnthropicProvider as Provider } from "@ai-sdk/anthropic";
import {
  AbstractProvider,
  type BaseProviderConfig,
  createProviderSchema,
  Modality,
} from "@yesimbot/shared-model";
import { Schema } from "koishi";

import enUS from "./locales/en-US.json";
import zhCN from "./locales/zh-CN.json";

interface AnthropicConfig extends BaseProviderConfig {
  projectId: string;
  sessionId: string;
}

function buildUserId(projectId: string, currentSessionId: string): string {
  return `user_${projectId}_account__session_${currentSessionId}`;
}

function isJsonContentType(headers: Headers): boolean {
  const ct = headers.get("content-type") || "";
  return ct.includes("application/json");
}

function parseBody(body: BodyInit | null | undefined): string | null {
  if (!body) return null;
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  return null;
}

class AnthropicProvider extends AbstractProvider<Provider, AnthropicConfig> {
  static reusable = true;
  static inject = ["yesimbot.model"];
  readonly providerType = "anthropic";

  protected createClient(config: AnthropicConfig) {
    const logger = this.ctx.logger("provider-anthropic");
    return createAnthropic({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      fetch: async (url: string | URL | Request, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        const method = (init?.method || "GET").toUpperCase();

        if (method !== "POST" || !isJsonContentType(headers)) {
          return fetch(url, init);
        }

        const rawBody = parseBody(init?.body);
        if (!rawBody) return fetch(url, init);

        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(rawBody);
        } catch (e) {
          logger.warn("Failed to parse request body as JSON", e);
          return fetch(url, init);
        }

        if (payload && typeof payload === "object") {
          if (!payload.metadata || typeof payload.metadata !== "object") {
            payload.metadata = {};
          }
          const meta = payload.metadata as Record<string, unknown>;
          if (meta.user_id == null) {
            meta.user_id = buildUserId(config.projectId, config.sessionId);
            logger.info("Injected user_id", { user_id: meta.user_id });
          }
        }

        headers.delete("content-length");

        return fetch(url, {
          ...init,
          headers,
          body: JSON.stringify(payload),
        });
      },
    });
  }
}

namespace AnthropicProvider {
  export type Config = AnthropicConfig;
  export const Config = createProviderSchema({
    defaultId: "anthropic",
    defaultBaseURL: "https://api.anthropic.com",
    defaultModels: [
      {
        id: "claude-sonnet-4-6",
        tool_call: true,
        reasoning: false,
        modalities: [Modality.Text, Modality.Image],
      },
      {
        id: "claude-opus-4-6",
        tool_call: true,
        reasoning: false,
        modalities: [Modality.Text, Modality.Image],
      },
      {
        id: "claude-haiku-4-5-20251001",
        tool_call: true,
        reasoning: false,
        modalities: [Modality.Text, Modality.Image],
      },
    ],
    extra: Schema.object({
      projectId: Schema.string().default("unknown"),
      sessionId: Schema.string().default("unknown"),
    }),
  }).i18n({
    "zh-CN": zhCN._config,
    "en-US": enUS._config,
  });
}

export default AnthropicProvider;
