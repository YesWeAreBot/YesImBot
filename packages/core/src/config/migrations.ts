import { Config, CONFIG_VERSION } from "./config";
import { ConfigV1 } from "./versions";

function migrateV1ToV2(configV1: ConfigV1): Config {
    const { modelService, agentBehavior, capabilities, assetService, promptService, system } = configV1;

    const { arousal, willingness, vision, prompt } = agentBehavior;

    return {
        version: 2,

        // 从 modelService 迁移
        ...modelService,

        // 从 agentBehavior 扁平化迁移
        ...arousal,
        ...willingness,
        ...vision,
        enableVision: vision?.enabled,
        ...prompt,
        streamAction: agentBehavior.streamAction,
        heartbeat: agentBehavior.heartbeat,
        newMessageStrategy: agentBehavior.newMessageStrategy,
        deferredProcessingTime: agentBehavior.deferredProcessingTime,

        // 从 capabilities 扁平化迁移
        ...capabilities.history,
        ...capabilities.memory,
        ...capabilities.tools,

        // 顶层服务直接迁移
        ...assetService,
        assetEndpoint: (assetService as any)?.endpoint,
        ...promptService,
        ...system,
    };
}

// 迁移函数映射表
const MIGRATIONS = {
    // 键是起始版本，值是迁移到下一版本的函数
    1: migrateV1ToV2,
    // 2: migrateV2ToV3,
};

export function migrateConfig(config: any): Config {
    let currentVersion = config.version || 1;
    let migratedConfig = { ...config };

    // 循环应用迁移，直到达到最新版本
    while (currentVersion < CONFIG_VERSION) {
        const migrator = MIGRATIONS[currentVersion];
        if (!migrator) {
            // 如果缺少某个版本的迁移脚本，抛出错误
            throw new Error(`缺少从版本 ${currentVersion} 到 ${currentVersion + 1} 的迁移脚本`);
        }
        migratedConfig = migrator(migratedConfig);
        currentVersion = migratedConfig.version;
    }

    return migratedConfig as Config;
}
