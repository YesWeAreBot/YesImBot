import { Schema } from "koishi";

export interface WorldStateConfig {
    DataRetentionDays: number;
    ActiveChannelHours: number;
    MaxTurnsPerChannel: number;
    MemberCacheSize: number;
    MemberCacheTTL: number;
}

export const WorldStateConfigSchema: Schema<WorldStateConfig> = Schema.object({
    DataRetentionDays: Schema.number().min(1).default(30).description("世界状态历史数据的保留天数。"),
    ActiveChannelHours: Schema.number().min(0.1).max(168).default(1).description("频道被视为“活跃”状态的小时数。"),
    MaxTurnsPerChannel: Schema.number().min(1).max(100).default(15).description("在世界状态中为每个频道显示的最大回合数。"),
    MemberCacheSize: Schema.number().min(100).max(10000).default(1000).description("成员信息缓存的最大条目数。"),
    MemberCacheTTL: Schema.number().min(60000).default(300000).description("成员信息缓存的有效期（毫秒）。"),
});
