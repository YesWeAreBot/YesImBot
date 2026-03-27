import { Context, Schema } from "koishi";

import { ModelService, ModelServiceConfig } from "./services/model";
import { PluginService, PluginServiceConfig } from "./services/plugin";
import { AgentSessionService, AgentSessionServiceConfig } from "./services/session";

interface Config extends ModelServiceConfig, AgentSessionServiceConfig, PluginServiceConfig {}

export const name = "yesimbot";
export const inject = [];
export const Config = Schema.object({
  model: Schema.dynamic("registry.chatModels"),
  basePath: Schema.path({ filters: ["directory"], allowCreate: true }).default(
    "data/yesimbot/agents",
  ),
  instructions: Schema.string(),
  maxSteps: Schema.number().default(5),
  logLevel: Schema.union([0, 1, 2, 3]).default(2),
});
export async function apply(ctx: Context, config: Config) {
  ctx.plugin(ModelService, config);
  ctx.plugin(AgentSessionService, config);
  ctx.plugin(PluginService, config);
}
