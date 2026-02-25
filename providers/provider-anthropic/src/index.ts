import { createAnthropic } from "@ai-sdk/anthropic";
import {
  IModelProvider,
  ModelInfo,
  Modality,
  IModelService,
  ModelDefaultParams,
} from "@yesimbot/shared-model";
import { Context, Schema } from "koishi";

declare module "koishi" {
  interface Context {
    "yesimbot.model": IModelService;
  }
}

export const name = "yesimbot-provider-anthropic";
export const reusable = true;
export const inject = ["yesimbot.model"];

export interface Config {
  id: string;
  apiKey: string;
  baseURL: string;
  models: Array<ModelInfo>;
  defaultParams: {
    temperature: number;
    maxTokens: number;
  };
  projectId: string;
  sessionId: string;
}

export const Config: Schema<Config> = Schema.object({
  id: Schema.string().default("anthropic"),
  apiKey: Schema.string().role("secret").required(),
  baseURL: Schema.string().default("https://api.anthropic.com"),
  models: Schema.array(
    Schema.object({
      id: Schema.string().required(),
      tool_call: Schema.boolean().default(true),
      reasoning: Schema.boolean().default(false),
      modalities: Schema.array(
        Schema.union([
          Schema.const(Modality.Audio),
          Schema.const(Modality.Image),
          Schema.const(Modality.Pdf),
          Schema.const(Modality.Text),
          Schema.const(Modality.Video),
        ]),
      )
        .default([Modality.Text])
        .role("checkbox"),
    }),
  )
    .default([
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
    ])
    .role("table"),
  defaultParams: Schema.object({
    temperature: Schema.number().default(0.7),
    maxTokens: Schema.number().default(2048),
  }),
  projectId: Schema.string().default("unknown"),
  sessionId: Schema.string().default("unknown"),
});

function buildUserId(projectId: string, currentSessionId: string): string {
  const pid = projectId;
  const sid = currentSessionId;
  return `user_${pid}_account__session_${sid}`;
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

class AnthropicProvider implements IModelProvider {
  readonly id: string;
  readonly providerType = "anthropic";
  readonly models: ModelInfo[];
  readonly defaultParams: ModelDefaultParams;
  private client: ReturnType<typeof createAnthropic>;

  constructor(
    private ctx: Context,
    config: Config,
  ) {
    this.id = config.id;
    this.defaultParams = config.defaultParams;
    this.client = createAnthropic({
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
          this.ctx.logger.warn("Failed to parse request body as JSON", e);
          return fetch(url, init);
        }

        if (payload && typeof payload === "object") {
          if (!payload.metadata || typeof payload.metadata !== "object") {
            payload.metadata = {};
          }
          const meta = payload.metadata as Record<string, unknown>;
          if (meta.user_id == null) {
            meta.user_id = buildUserId(config.projectId, config.sessionId);
            ctx.logger.info("Injected user_id", { user_id: meta.user_id });
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
    this.models = config.models.map((m) => ({
      id: m.id,
      tool_call: m.tool_call,
      reasoning: m.reasoning,
      modalities: m.modalities,
      defaultParams: config.defaultParams,
    }));
  }

  getModel(modelId: string) {
    return this.client.chat(modelId);
  }

  listModels(): Record<string, ModelInfo> {
    return Object.fromEntries(this.models.map((m) => [m.id, m]));
  }

  getDefaultParams(): ModelDefaultParams {
    return this.defaultParams;
  }
}

export function apply(ctx: Context, config: Config) {
  const provider = new AnthropicProvider(ctx, config);
  ctx["yesimbot.model"].registerProvider(config.id, provider);
}
