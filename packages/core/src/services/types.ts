/**
 * 集中管理所有数据库表的名称，防止拼写错误并方便重构。
 */
export enum TableName {
    Members = "worldstate.members",
    DialogueSegments = "worldstate.dialogue_segments",
    Messages = "worldstate.messages",
    SystemEvents = "worldstate.system_events",
    Images = "yesimbot.images",
}

/**
 * 提供的服务。
 */
export enum Services {
    Model = "yesimbot.model",
    Memory = "yesimbot.memory",
    WorldState = "yesimbot.world-state",
    Tool = "yesimbot.tool",
    Image = "yesimbot.image",
}
