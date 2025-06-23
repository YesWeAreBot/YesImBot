import { Context } from "koishi";
import { WorldStateConfig, WorldStateConfigSchema } from "./config";
import * as Models from "./model";
import { WorldStateService } from "./world-state-service";

export * from "./config";
export * from "./interfaces";
export * from "./model";
export * from "./repositories";
export * from "./world-state-service";

/**
 * 注册 WorldState 服务的插件。
 * 这样可以方便地在 Koishi 配置文件中通过 `ctx.plugin(worldStatePlugin, config)` 来启用服务。
 */
export const name = "world-state-plugin";
export const inject = {
    required: ["database"],
};

export function apply(ctx: Context, config: WorldStateConfig) {
    // 1. 应用所有数据库模型定义
    ctx.plugin(Models);

    // 2. 注册 WorldStateService
    // Koishi 会自动处理服务的实例化和生命周期
    ctx.plugin(WorldStateService, config);
}

// 为插件定义配置
export const Config = WorldStateConfigSchema;
