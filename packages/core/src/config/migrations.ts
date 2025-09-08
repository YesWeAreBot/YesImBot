import { Config, CONFIG_VERSION } from "./config";
import { ConfigV1, ConfigV200 } from "./versions";
import semver from "semver";

function migrateV1ToV200(configV1: ConfigV1): Omit<Config, "enableTelemetry" | "sentryDsn"> {
    const { modelService, agentBehavior, capabilities, assetService, promptService, system } = configV1;

    const { arousal, willingness, vision, prompt } = agentBehavior || {};

    return {
        version: "2.0.0",

        // 从 modelService 迁移
        ...modelService,

        // 从 agentBehavior 扁平化迁移
        ...arousal,
        ...willingness,
        ...vision,
        enableVision: vision?.enabled,
        ...prompt,
        streamAction: agentBehavior?.streamAction,
        heartbeat: agentBehavior?.heartbeat,
        newMessageStrategy: agentBehavior?.newMessageStrategy,
        deferredProcessingTime: agentBehavior?.deferredProcessingTime,

        // 从 capabilities 扁平化迁移
        ...capabilities?.history,
        ...capabilities?.memory,
        ...capabilities?.tools,

        // 顶层服务直接迁移
        ...assetService,
        assetEndpoint: (assetService as any)?.endpoint,
        ...promptService,
        ...system,
    };
}

function migrateV200ToV201(configV200: ConfigV200): Config {
    return {
        ...configV200,
        version: "2.0.1",
    };
}

// 迁移函数映射表
const MIGRATIONS = {
    // 键是起始版本，值是迁移到下一版本的函数
    "1.0.0": migrateV1ToV200,
    "2.0.0": migrateV200ToV201,
    // "2.0.1"
};

export function migrateConfig(config: any): Config {
    let migratedConfig = { ...config };
    let currentVersion = String(migratedConfig.version);

    if (currentVersion == "2") {
        currentVersion = "2.0.0";
    }

    while (semver.lt(currentVersion, CONFIG_VERSION)) {
        const migrator = MIGRATIONS[currentVersion];
        if (!migrator) {
            // 如果缺少某个版本的迁移脚本，抛出错误
            throw new Error(`缺少从版本 ${currentVersion} 的迁移脚本`);
        }
        migratedConfig = migrator(migratedConfig);
        currentVersion = migratedConfig.version; // 从返回结果中获取新的版本号

        if (!currentVersion) {
            throw new Error(`迁移函数 ${migrator.name} 未返回新的版本号`);
        }
    }

    return migratedConfig as Config;
}
