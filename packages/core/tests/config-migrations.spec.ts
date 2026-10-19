import { expect, it } from "vitest";

import { Config, CONFIG_VERSION, migrateConfig } from "../src/config";
import { ContentFailureAction, ModelAbility, ModelSwitchingStrategy } from "../src/model/config";

function modelSettings() {
    return {
        providers: [
            {
                name: "legacy",
                type: "OpenAI Compatible",
                apiKey: "fixture-api-key",
                baseURL: "https://models.invalid/v1/",
                models: [
                    {
                        modelId: "chat",
                        abilities: [ModelAbility.Chat],
                        parameters: { temperature: 0, stream: false },
                        retryPolicy: { maxRetries: 0, onContentFailure: ContentFailureAction.FailoverToNext },
                    },
                ],
            },
        ],
        modelGroups: [
            {
                name: "custom",
                models: [{ providerName: "legacy", modelId: "chat" }],
                strategy: ModelSwitchingStrategy.RoundRobin,
            },
        ],
        task: { chat: "custom", embed: "custom" },
    };
}

function legacyV1() {
    return {
        version: "1.0.0",
        modelService: modelSettings(),
        agentBehavior: {
            arousal: { allowedChannels: [{ platform: "onebot", type: "guild", id: "room" }], debounceMs: 0 },
            willingness: {
                base: { text: 0 },
                attribute: { atMention: 0, isQuote: 0, isDirectMessage: 0 },
                interest: { keywords: [], keywordMultiplier: 0, defaultMultiplier: 0 },
                lifecycle: { maxWillingness: 100, decayHalfLifeSeconds: 5, probabilityThreshold: 0, probabilityAmplifier: 0.01, replyCost: 0 },
            },
            vision: { enabled: false, allowedImageTypes: [], maxImagesInContext: 0, imageLifecycleCount: 0, detail: "auto" },
            prompt: { systemTemplate: "custom system", userTemplate: "custom user", multiModalSystemTemplate: "custom images" },
            streamAction: false,
            heartbeat: 1,
            newMessageStrategy: "deferred",
            deferredProcessingTime: 0,
        },
        capabilities: {
            history: {
                l1_memory: { maxMessages: 0, pendingTurnTimeoutSec: 0, keepFullTurnCount: 0 },
                l2_memory: { enabled: false, retrievalK: 0, retrievalMinSimilarity: 0, messagesPerChunk: 4, includeNeighborChunks: false },
                l3_memory: { enabled: false, diaryGenerationTime: "00:00" },
                ignoreSelfMessage: false,
                dataRetentionDays: 0,
                cleanupIntervalSec: 0,
            },
            memory: { coreMemoryPath: "fixture/memory" },
            tools: { extra: { addon: { enabled: false, count: 0 } }, advanced: { maxRetry: 0, retryDelay: 0, timeout: 0 } },
        },
        assetService: {
            storagePath: "fixture/assets",
            driver: "local",
            endpoint: "https://assets.invalid/files",
            maxFileSize: 1,
            downloadTimeout: 1000,
            autoClear: { enabled: false, intervalHours: 1, maxAgeDays: 1 },
            image: { processedCachePath: "fixture/images", targetSize: 512, maxSizeMB: 0.5, gifProcessingStrategy: "firstFrame", gifFramesToExtract: 2 },
            recoveryEnabled: false,
        },
        promptService: { injectionPlaceholder: "plugins", maxRenderDepth: 1 },
        system: { logging: { level: 0 }, errorReporting: { enabled: false, includeSystemInfo: false, pasteServiceUrl: "https://reports.invalid/" } },
    };
}

it("migrates every v1 configuration section through the live version chain and current schema", () => {
    const source = legacyV1();
    const original = structuredClone(source);
    const migrated = migrateConfig(source);
    expect(source).toEqual(original);
    expect(migrated.version).toBe(CONFIG_VERSION);

    const validated = Config(migrated, { autofix: true });
    expect(validated).toMatchObject({
        version: CONFIG_VERSION,
        providers: source.modelService.providers,
        modelGroups: source.modelService.modelGroups,
        task: source.modelService.task,
        allowedChannels: source.agentBehavior.arousal.allowedChannels,
        debounceMs: 0,
        base: { text: 0 },
        attribute: { atMention: 0, isQuote: 0, isDirectMessage: 0 },
        interest: { keywords: [], keywordMultiplier: 0, defaultMultiplier: 0 },
        lifecycle: { probabilityThreshold: 0, replyCost: 0 },
        enableVision: false,
        allowedImageTypes: [],
        maxImagesInContext: 0,
        imageLifecycleCount: 0,
        detail: "auto",
        systemTemplate: "custom system",
        userTemplate: "custom user",
        multiModalSystemTemplate: "custom images",
        streamAction: false,
        heartbeat: 1,
        newMessageStrategy: "deferred",
        deferredProcessingTime: 0,
        l1_memory: source.capabilities.history.l1_memory,
        l2_memory: source.capabilities.history.l2_memory,
        l3_memory: { enabled: false, diaryGenerationTime: "00:00" },
        ignoreSelfMessage: false,
        dataRetentionDays: 0,
        cleanupIntervalSec: 0,
        coreMemoryPath: "fixture/memory",
        extra: { addon: { enabled: false, count: 0 } },
        advanced: { maxRetry: 0, retryDelay: 0, timeout: 0 },
        storagePath: "fixture/assets",
        driver: "local",
        assetEndpoint: "https://assets.invalid/files",
        autoClear: { enabled: false },
        image: source.assetService.image,
        recoveryEnabled: false,
        injectionPlaceholder: "plugins",
        maxRenderDepth: 1,
        logging: { level: 0 },
        errorReporting: { enabled: false, includeSystemInfo: false },
    });
    // New settings still receive current defaults after old values have been preserved.
    expect(validated.contextInputBudgetTokens).toBe(16000);
    expect(validated.nativeToolCalling).toBe(false);
    expect(validated.providers[0].models[0].contextLimit?.mode).toBe("unset");
    expect(migrateConfig(validated)).toEqual(validated);
});

it.each([true, false])("preserves the v1 vision choice %s while renaming the field", (enabled) => {
    const source = legacyV1();
    source.agentBehavior.vision.enabled = enabled;
    expect(Config(migrateConfig(source), { autofix: true }).enableVision).toBe(enabled);
});

it.each(["2.0.0", "2", 2])("migrates flat version %s without changing explicit false or zero values", (version) => {
    const source = {
        version,
        ...modelSettings(),
        enableVision: false,
        streamAction: false,
        debounceMs: 0,
        base: { text: 0 },
        lifecycle: { probabilityThreshold: 0, replyCost: 0 },
        l2_memory: { enabled: false, retrievalK: 0, includeNeighborChunks: false },
        assetEndpoint: "https://assets.invalid/flat",
        autoClear: { enabled: false },
        recoveryEnabled: false,
        logging: { level: 0 },
        errorReporting: { enabled: false, includeSystemInfo: false },
        extra: { addon: { enabled: false, count: 0 } },
    };
    const original = structuredClone(source);
    const migrated = migrateConfig(source);
    expect(migrated).toEqual({ ...original, version: CONFIG_VERSION });
    expect(source).toEqual(original);
    expect(Config(migrated, { autofix: true })).toMatchObject({ ...original, version: CONFIG_VERSION });
});

it("validates a sparse v1 configuration with current defaults", () => {
    const migrated = Config(migrateConfig({ version: "1.0.0", modelService: modelSettings() }), { autofix: true });
    expect(migrated.version).toBe(CONFIG_VERSION);
    expect(migrated.task.chat).toBe("custom");
    expect(migrated.enableVision).toBe(false);
    expect(migrated.heartbeat).toBe(5);
    expect(migrated.errorReporting.includeSensitiveInfo).toBe(false);
});

it("rejects an unrecognized older version without modifying its input", () => {
    const source = { version: "1.5.0", enableVision: false };
    expect(() => migrateConfig(source)).toThrow("缺少从版本 1.5.0 的迁移脚本");
    expect(source).toEqual({ version: "1.5.0", enableVision: false });
});
