import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Context } from "koishi";
import { test } from "vitest";

import { ChatModel } from "../src/model/chat-model";
import { ModelAbility, ModelConfig, ProviderConfig } from "../src/model/config";
import { getContextSnapshots } from "../src/model/context-snapshot";
import { EmbedModel } from "../src/model/embed-model";
import { EvaluationModel } from "../src/model/evaluation-model";
import type { IProviderClient } from "../src/model/factories";
import { ProviderInstance } from "../src/model/provider-instance";
import { getUsageLedger, observeUsageFetch } from "../src/model/usage";
import type { UsageOwner } from "../src/model/usage-owner";
import { loggingStub } from "./helpers/yesimbot";

/**
 * 测试用的 ctx 桩：只实现统计路径读取到的成员。
 *
 * `yesimbot.model` 故意做成访问器：telemetry 一旦绕过显式归属去查模型服务，
 * 就会被计数或抛错。日志归属仍走 `yesimbot.logging`，不属于本测试的断言范围。
 */
function telemetryContext(baseDir: string, key: string, onModelLookup: () => void): Context {
    const ctx = {
        baseDir,
        scope: { key },
        logger: () => ({ warn() {} }),
        yesimbot: {
            logging: { getLogger: () => ({ warn() {} }) },
            get model() {
                onModelLookup();
                return undefined;
            },
        },
    };
    // 测试边界上的显式转换：桩 ctx 只实现被测路径读取到的成员。
    return ctx as unknown as Context;
}

/** 测试会直接调用模型实际持有的传输句柄，以断言它带上了显式归属。 */
type FetchHolder = { fetch: typeof globalThis.fetch };

test("explicit telemetry owner avoids model service lookup and shares history/reset across contexts", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "yib-owner-"));
    let modelLookups = 0;
    const countLookup = () => modelLookups++;
    const providerCtx = telemetryContext(dir, "provider", countLookup);
    const commandCtx = telemetryContext(dir, "command", countLookup);
    const ownerA: UsageOwner = { context: telemetryContext(dir, "instance-a", countLookup) };
    const ownerB: UsageOwner = { context: telemetryContext(dir, "instance-b", countLookup) };
    try {
        const fetch = observeUsageFetch(
            providerCtx,
            { provider: "DS", model: "test" },
            async () => new Response(JSON.stringify({ usage: { prompt_tokens: 10, completion_tokens: 2 }, choices: [] })),
            ownerA,
        );
        const response = await fetch("https://example.invalid", { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }) });
        await response.json();
        const ledger = getUsageLedger(commandCtx, ownerA);
        assert.equal((await ledger.snapshot()).records.length, 1);
        assert.equal(getContextSnapshots(commandCtx, ownerA).length, 1);
        assert.equal((await getUsageLedger(commandCtx, ownerB).snapshot()).records.length, 0);
        assert.equal(getContextSnapshots(commandCtx, ownerB).length, 0);
        await ledger.reset("admin");
        assert.equal(getContextSnapshots(providerCtx, ownerA).length, 0);
        assert.equal(modelLookups, 0, "telemetry must not look up ctx.yesimbot.model when the owner is explicit");
        await ledger.close();
        await getUsageLedger(commandCtx, ownerB).close();
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("provider-created chat, embedding and evaluation transports retain the explicit instance owner", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "yib-model-owner-"));
    let modelLookups = 0;
    const ctx = telemetryContext(dir, "owner-models", () => {
        modelLookups++;
        throw new Error("undeclared model lookup");
    });
    const owner: UsageOwner = { context: ctx };
    const config: ModelConfig = {
        modelId: "test",
        abilities: [ModelAbility.Chat, ModelAbility.Embedding, ModelAbility.Evaluation],
        parameters: { custom: [] },
    };
    const providerConfig: ProviderConfig = { name: "test", type: "OpenAI", apiKey: "test", models: [config] };
    // 测试替身：被测路径只读取能力是否存在，不会真正调用提供商函数。
    const client = { chat: () => ({}), embed: () => ({}), evaluate: () => ({}) } as unknown as IProviderClient;
    const provider = new ProviderInstance(ctx, providerConfig, client, loggingStub(), owner);
    (provider as unknown as FetchHolder).fetch = async () => new Response(JSON.stringify({ usage: { prompt_tokens: 10, completion_tokens: 2 }, choices: [] }));
    try {
        const models = [provider.getChatModel("test"), provider.getEmbedModel("test"), provider.getEvaluationModel("test")];
        assert.ok(models[0] instanceof ChatModel);
        assert.ok(models[1] instanceof EmbedModel);
        assert.ok(models[2] instanceof EvaluationModel);
        for (const model of models) {
            const response = await (model as unknown as FetchHolder).fetch("https://example.invalid", {
                method: "POST",
                body: JSON.stringify({ messages: [] }),
            });
            await response.json();
        }
        const ledger = getUsageLedger(ctx, owner);
        const snapshot = await ledger.snapshot();
        assert.deepEqual(snapshot.records.map((row) => row.purpose).sort(), ["对话", "嵌入", "评估"].sort());
        assert.equal(getContextSnapshots(ctx, owner).length, 3);
        assert.equal(modelLookups, 0, "provider transports must carry the owner instead of looking it up");
        await ledger.close();
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
