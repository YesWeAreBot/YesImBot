import { Context, Schema } from "koishi";

import { ModelService, ModelServiceConfig } from "./services/model";
import { PluginService, PluginServiceConfig } from "./services/plugin";
import { AgentSessionService, AgentSessionServiceConfig } from "./services/session";

interface Config extends ModelServiceConfig, AgentSessionServiceConfig, PluginServiceConfig {}

export const name = "yesimbot";
export const inject = [];
export const Config = Schema.object({
  model: Schema.dynamic("registry.chatModels"),
  compactionModel: Schema.dynamic("registry.chatModels").description(
    "Model for compaction summarization (defaults to main model)",
  ),
  compactionEnabled: Schema.boolean().default(true).description("Enable auto-compaction"),
  compactionReserveTokens: Schema.number()
    .default(16384)
    .description("Tokens reserved for model output"),
  compactionKeepRecentTokens: Schema.number()
    .default(20000)
    .description("Recent tokens to keep after compaction"),
  contextWindow: Schema.number().default(128000).description("Context window size in tokens"),
  judgeModel: Schema.dynamic("registry.chatModels"),
  judgeEnabled: Schema.boolean().default(false),
  judgeTimeoutMs: Schema.number().default(10000),
  basePath: Schema.path({ filters: ["directory"], allowCreate: true }).default(
    "data/yesimbot/agents",
  ),
  instructions: Schema.string().role("textarea"),
  streaming: Schema.boolean().default(false).description("Enable streaming responses"),
  maxSteps: Schema.number().default(20),
  baseTimeoutMs: Schema.number().default(60000).description("Base response timeout in ms"),
  perStepTimeoutMs: Schema.number().default(30000).description("Additional timeout per step in ms"),
  chunkTimeoutMs: Schema.number().default(10000).description("Chunk streaming timeout in ms"),
  sendMessageDirectly: Schema.boolean().default(false),
  enableWorkspace: Schema.boolean().default(true),
  enableSandbox: Schema.boolean().default(false),
  enableFilesystem: Schema.boolean().default(true),
  externalPath: Schema.array(Schema.path({ allowCreate: true }))
    .role("table")
    .default([]),
  logLevel: Schema.union([0, 1, 2, 3]).default(2),
});
export async function apply(ctx: Context, config: Config) {
  ctx.plugin(ModelService, config);
  ctx.plugin(PluginService, config);
  ctx.plugin(AgentSessionService, config);
}
