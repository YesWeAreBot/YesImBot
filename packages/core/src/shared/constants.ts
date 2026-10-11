import path from "path";
import { createRequire } from "node:module";

// Resolve the owning package instead of depending on the bundled entry directory.
const packageRequire = createRequire(path.join(__dirname, "package.json"));
export const BASE_DIR = path.dirname(packageRequire.resolve("koishi-plugin-yesimbot/package.json"));
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
    BotMuteState = "worldstate.bot_mute_state",
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
