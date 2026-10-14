import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getUsageLedger, observeUsageFetch } from "../src/services/model/usage";
import { getContextSnapshots } from "../src/services/model/context-snapshot";

test("explicit telemetry owner avoids model service lookup and shares history/reset across contexts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "yib-owner-"));
    let lookups = 0;
    const context = (key: string): any => {
        const ctx = { baseDir: dir, scope: { key }, logger: () => ({ warn() {} }) };
        Object.defineProperty(ctx, "yesimbot.model", { get() { lookups++; return undefined; } });
        return ctx;
    };
    const providerCtx = context("provider");
    const commandCtx = context("command");
    const ownerA = { context: context("instance-a") };
    const ownerB = { context: context("instance-b") };
    try {
        const fetch = observeUsageFetch(providerCtx, { provider: "DS", model: "test" },
            async () => new Response(JSON.stringify({ usage: { prompt_tokens: 10, completion_tokens: 2 }, choices: [] })), ownerA);
        const response = await fetch("https://example.invalid", { body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }) });
        await response.json();
        const ledger = getUsageLedger(commandCtx, ownerA);
        assert.equal((await ledger.snapshot()).records.length, 1);
        assert.equal(getContextSnapshots(commandCtx, ownerA).length, 1);
        assert.equal((await getUsageLedger(commandCtx, ownerB).snapshot()).records.length, 0);
        assert.equal(getContextSnapshots(commandCtx, ownerB).length, 0);
        await ledger.reset("admin");
        assert.equal(getContextSnapshots(providerCtx, ownerA).length, 0);
        assert.equal(lookups, 0, "telemetry must not access undeclared model service");
        await ledger.close();
        await getUsageLedger(commandCtx, ownerB).close();
    } finally { await rm(dir, { recursive: true, force: true }); }
});

import { ChatModel } from "../src/services/model/chat-model";
import { EmbedModel } from "../src/services/model/embed-model";
import { EvaluationModel } from "../src/services/model/evaluation-model";
import { ProviderInstance } from "../src/services/model/provider-instance";
import { ModelAbility } from "../src/services/model/config";
import { Services } from "../src/shared/constants";

test("provider-created chat, embedding and evaluation transports retain the explicit instance owner", async () => {
    const dir = await mkdtemp(join(tmpdir(), "yib-model-owner-"));
    const logger = { debug() {}, info() {}, warn() {}, error() {}, success() {} };
    const ctx: any = { baseDir: dir, scope: { key: "owner-models" }, [Services.Logger]: { getLogger: () => logger } };
    Object.defineProperty(ctx, Services.Model, { get() { throw new Error("undeclared model lookup"); } });
    const owner = { context: ctx };
    const config: any = { modelId: "test", abilities: [ModelAbility.Chat, ModelAbility.Embedding, ModelAbility.Evaluation], parameters: { custom: [] } };
    const client: any = { chat() {}, embed() {}, evaluate() {} };
    const provider: any = new ProviderInstance(ctx, { name: "test", models: [config] } as any, client, owner);
    provider.fetch = async () => new Response(JSON.stringify({ usage: { prompt_tokens: 10, completion_tokens: 2 }, choices: [] }));
    try {
        const models = [provider.getChatModel("test"), provider.getEmbedModel("test"), provider.getEvaluationModel("test")];
        assert.ok(models[0] instanceof ChatModel);
        assert.ok(models[1] instanceof EmbedModel);
        assert.ok(models[2] instanceof EvaluationModel);
        for (const model of models) {
            const response = await model.fetch("https://example.invalid", { body: JSON.stringify({ messages: [] }) });
            await response.json();
        }
        const ledger = getUsageLedger(ctx, owner);
        const snapshot = await ledger.snapshot();
        assert.deepEqual(snapshot.records.map(row => row.purpose).sort(), ["对话", "嵌入", "评估"].sort());
        assert.equal(getContextSnapshots(ctx, owner).length, 3);
        await ledger.close();
    } finally { await rm(dir, { recursive: true, force: true }); }
});
