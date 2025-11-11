import path from "node:path";

function getBaseDir(): string {
    if (__dirname.includes("node_modules") || __dirname.endsWith(path.join("core", "lib"))) {
        return path.resolve(__dirname, "../");
    }
    return path.resolve(__dirname, "../../");
}

export const BASE_DIR = getBaseDir();
export const RESOURCES_DIR = path.resolve(BASE_DIR, "resources");
export const PROMPTS_DIR = path.resolve(RESOURCES_DIR, "prompts");
export const TEMPLATES_DIR = path.resolve(RESOURCES_DIR, "templates");

/**
 * 所有数据库表的名称
 */
export enum TableName {
    Members = "worldstate.members",
    Events = "yesimbot.events",
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
    Memory = "yesimbot.memory",
    Model = "yesimbot.model",
    Prompt = "yesimbot.prompt",
    Telemetry = "yesimbot.telemetry",
    WorldState = "yesimbot.world-state",
    Plugin = "yesimbot.plugin",
    Command = "yesimbot.command",
}
