import { Schema } from "koishi";

export interface PlatformServiceConfig {
    Cache: {
        TTL: number;
        MaxSize: number;
    };
}

export const PlatformServiceConfigSchema: Schema<PlatformServiceConfig> = Schema.object({
    Cache: Schema.object({
        TTL: Schema.number().min(1).max(1440).default(5).description("缓存时间（分钟）"),
        MaxSize: Schema.number().min(100).max(10000).default(1000).description("最大缓存数量"),
    }).description("缓存配置"),
}).description("平台服务配置");
