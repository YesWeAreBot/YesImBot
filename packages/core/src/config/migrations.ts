import type { Config } from "./config";

import type { ConfigV1, ConfigV200 } from "./versions";
import type { ConfigV201 } from "./versions/v201";
import semver from "semver";
import { ModelType, SwitchStrategy } from "@/services/model/types";
import { CONFIG_VERSION } from "./config";
import * as V201 from "./versions/v201";

/**
 * Migrate a v1 configuration object to the v2.0.0 configuration shape.
 *
 * Produces a new config with version "2.0.0" by:
 * - copying top-level service sections (modelService, assetService, promptService, system),
 * - flattening nested agentBehavior fields (arousal, willingness, vision, prompt) into the top level,
 * - setting `enableVision` from `vision?.enabled`,
 * - carrying selected agentBehavior flags (streamAction, heartbeat, newMessageStrategy, deferredProcessingTime),
 * - flattening capabilities (history, memory, tools) into the top level,
 * - mapping `assetEndpoint` from `assetService.endpoint`.
 *
 * @param configV1 - The original configuration in the 1.0.0 shape to migrate.
 * @returns A config object shaped as v2.0.0 (omitting `enableTelemetry` and `sentryDsn`).
 */
function migrateV1ToV200(configV1: ConfigV1): Omit<ConfigV200, "enableTelemetry" | "sentryDsn"> {
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

/**
 * Migrate a 2.0.0 config object to the 2.0.1 shape by preserving all fields and updating the version.
 *
 * @param configV200 - Configuration object with version "2.0.0"
 * @returns The same configuration adjusted to version "2.0.1"
 */
function migrateV200ToV201(configV200: ConfigV200): ConfigV201 {
    return {
        ...configV200,
        version: "2.0.1",
    };
}

/**
 * Migrates a v2.0.1 configuration to the v2.0.2 shape.
 *
 * Produces a new Config with:
 * - chatModelGroup set from `task.chat`
 * - embeddingModel taken from the first model of the model group named by `task.embed` (both `providerName` and `modelId` default to empty strings if not found)
 * - ignoreCommandMessage set to `false`
 * - version set to `"2.0.2"`
 *
 * The function does not mutate the input; it clones the input before reading. The rest of the configuration fields are preserved unchanged.
 *
 * @param configV201 - Configuration object in the v2.0.1 shape to migrate
 * @returns The migrated configuration in the v2.0.2 shape
 */
function migrateV201ToV202(configV201: ConfigV201): Config {
    const embeddingGroup = configV201.modelGroups.find((group) => group.name === configV201.task.embed);
    const embeddingModel: V201.ModelDescriptor | undefined = embeddingGroup?.models?.[0];

    const { task, ...rest } = configV201;

    const providers: Config["providers"] = configV201.providers.map((provider) => {
        const models: Config["providers"][number]["models"] = provider.models.map((model) => {
            const modelType = model.abilities.includes(V201.ModelAbility.Chat)
                ? ModelType.Chat
                : model.abilities.includes(V201.ModelAbility.Embedding)
                    ? ModelType.Embedding
                    : ModelType.Image;
            return { ...model, modelType };
        });
        return { ...provider, models };
    });

    return {
        ...rest,
        providers,
        chatModelGroup: configV201.task.chat,
        embeddingModel: {
            providerName: embeddingModel?.providerName || "",
            modelId: embeddingModel?.modelId || "",
        },
        maxMessages: configV201.l1_memory?.maxMessages,
        // ignoreCommandMessage: false,
        switchConfig: {
            strategy: SwitchStrategy.Failover,
            firstToken: 30000,
            requestTimeout: 60000,
            maxRetries: 3,
            breaker: {
                enabled: false,
            },
        },
        stream: true,
        telemetry: {},
        logLevel: 2,
        version: "2.0.2",
    };
}

// 迁移函数映射表
const MIGRATIONS = {
    // 键是起始版本，值是迁移到下一版本的函数
    "1.0.0": migrateV1ToV200,
    "2.0.0": migrateV200ToV201,
    "2.0.1": migrateV201ToV202,
};

/**
 * Migrate an arbitrary configuration object forward to the current CONFIG_VERSION.
 *
 * Repeatedly applies versioned migration functions until the config reaches the latest version.
 *
 * @param config - A configuration object of any (possibly older) schema version. The object must include a `version` field indicating its current semantic version.
 * @returns The migrated configuration shaped as the current `Config` type and annotated with the latest `version`.
 *
 * @throws Error If a required migration step is missing for a detected intermediate version.
 * @throws Error If a migration function returns a config without a `version` field.
 */
export function migrateConfig(config: any): Config {
    let migratedConfig = { ...config };
    let currentVersion = String(migratedConfig.version);

    if (currentVersion === "2") {
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
