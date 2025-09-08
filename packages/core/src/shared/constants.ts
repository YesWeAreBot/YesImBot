import path from "path";

export const BASE_DIR = path.resolve(__dirname, "../../");
export const RESOURCES_DIR = path.resolve(BASE_DIR, "resources");
export const PROMPTS_DIR = path.resolve(RESOURCES_DIR, "prompts");
export const TEMPLATES_DIR = path.resolve(RESOURCES_DIR, "templates");

/**
 * 所有数据库表的名称
 */
export enum TableName {
    Members = "worldstate.members",
    Messages = "worldstate.messages",
    SystemEvents = "worldstate.system_events",
    L2Chunks = "worldstate.l2_chunks",
    L3Diaries = "worldstate.l3_diaries",

    Assets = "yesimbot.assets",
    Stickers = "yesimbot.stickers",
}

/**
 * 提供的服务
 */
export enum Services {
    Agent = "yesimbot.agent",
    Asset = "yesimbot.asset",
    Config = "yesimbot.config",
    Logger = "yesimbot.logger",
    Memory = "yesimbot.memory",
    Model = "yesimbot.model",
    Prompt = "yesimbot.prompt",
    Tool = "yesimbot.tool",
    WorldState = "yesimbot.world-state",
}
