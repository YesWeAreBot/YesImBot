import path from "path";

export const BASE_DIR = path.resolve(__dirname, "../../");
export const RESOURCES_DIR = path.resolve(BASE_DIR, "resources");
export const PROMPTS_DIR = path.resolve(RESOURCES_DIR, "prompts");
export const TEMPLATES_DIR = path.resolve(RESOURCES_DIR, "templates");

/**
 * 所有数据库表的名称
 */
export enum TableName {
    Interactions = "worldstate.interactions",
    AgentTurns = "worldstate.agent_turns",
    Members = "worldstate.members",
    Messages = "worldstate.messages",
    SystemEvents = "worldstate.system_events",
    L2Chunks = "worldstate.l2_chunks",
    L3Diaries = "worldstate.l3_diaries",

    Assets = "yesimbot.assets",
    Entities = "yesimbot.entities",
    Facts = "yesimbot.facts",
    Insights = "yesimbot.insights",
    UserProfiles = "yesimbot.user_profiles",
    Stickers = "yesimbot.stickers",
}

/**
 * 提供的服务
 */
export enum Services {
    Model = "yesimbot.model",
    Memory = "yesimbot.memory",
    WorldState = "yesimbot.world-state",
    Tool = "yesimbot.tool",
    Asset = "yesimbot.asset",
    Logger = "yesimbot.logger",
    Prompt = "yesimbot.prompt",
}
