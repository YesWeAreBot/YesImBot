import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Schema } from "koishi";
import { afterEach, expect, it } from "vitest";

import { HeartbeatProcessor } from "../src/agent/heartbeat-processor";
import { ToolService } from "../src/extension/service";
import { ChatModel } from "../src/model/chat-model";
import { ContentFailureAction, ModelAbility } from "../src/model/config";
import { ChatModelSwitcher } from "../src/model/service";
import { loggingStub, stubCtx } from "./helpers/yesimbot";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const plan = (actions: unknown[]) =>
    JSON.stringify({ thoughts: { observe: "current request", analyze_infer: "answer", plan: "send" }, actions, request_heartbeat: false });
function response(text: string, stream: boolean) {
    if (!stream) return Response.json({ id: "model-response", choices: [{ message: { role: "assistant", content: text }, finish_reason: "stop" }], usage: {} });
    const chunk = { id: "model-response", choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] };
    const end = { id: "model-response", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: {} };
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(end)}\n\ndata: [DONE]\n\n`, {
        headers: { "content-type": "text/event-stream" },
    });
}
async function fixture(stream: boolean, outputs: string[]) {
    const baseDir = await mkdtemp(path.join(tmpdir(), "yib-json-validation-"));
    const logger = {
        extend() {
            return this;
        },
        info() {},
        warn() {},
        error() {},
        debug() {},
        success() {},
    };
    const logging = loggingStub(logger);
    const ctx = stubCtx({}, { baseDir, filter: () => true });
    const requests: any[] = [],
        invocations: any[] = [];
    const model = new ChatModel(
        ctx,
        (model) => ({ model, baseURL: "https://model.invalid/v1/", apiKey: "test" }),
        {
            modelId: "primary",
            abilities: [ModelAbility.Chat],
            parameters: { stream },
            timeoutPolicy: { totalTimeout: 10 },
            retryPolicy: { maxRetries: 1, onContentFailure: ContentFailureAction.AugmentAndRetry },
        },
        (async (_url, init) => {
            requests.push(JSON.parse(init!.body as string));
            return response(outputs.shift()!, stream);
        }) as typeof fetch,
        logging,
    );
    const switcher = new ChatModelSwitcher(ctx, { name: "chat", models: [{ providerName: "test", modelId: "primary" }] }, () => model, logging);
    const tools = new ToolService(ctx, { advanced: { maxRetry: 0 } } as any, { logging } as any);
    tools.registerTool({
        name: "send_message",
        description: "send",
        parameters: Schema.object({ message: Schema.string().required() }),
        execute: async (args) => {
            invocations.push(args.message);
            return { status: "success" };
        },
    });
    tools.registerTool({
        name: "noop",
        description: "read",
        readOnly: true,
        parameters: Schema.object({}),
        execute: async () => {
            invocations.push("noop");
            return { status: "success" };
        },
    });
    const processor = new HeartbeatProcessor(ctx, { heartbeat: 1, streamAction: stream } as any, {
        model: switcher,
        tool: tools,
        prompt: {} as any,
        world: {} as any,
        contextBuilder: {} as any,
        logging,
        l1: { recordThought: async () => {}, recordAction: async () => "action", recordObservation: async () => {} } as any,
    });
    (processor as any)._prepareLlmRequest = async () => ({
        messages: [
            { role: "system", content: "KEEP_PERSONA" },
            { role: "user", content: "ORIGINAL_QUESTION" },
        ],
    });
    cleanups.push(async () => {
        await tools.stop();
        await rm(baseDir, { recursive: true, force: true });
    });
    return { requests, invocations, run: () => processor.runCycle({ session: { platform: "test", channelId: "group" } } as any) };
}

for (const stream of [false, true]) {
    for (const invalid of [
        null,
        {},
        { function: 7 },
        { function: "" },
        { function: "send_message", params: "bad" },
        { function: "send_message", params: null },
        { function: "send_message", params: [] },
    ]) {
        it(`${stream ? "streaming" : "JSON"} corrects invalid action shape ${JSON.stringify(invalid)} before any tool executes`, async () => {
            // A valid-looking earlier action in the same invalid batch must not execute.
            const malformed = plan([{ function: "send_message", params: { message: "discard this batch" } }, invalid]);
            const f = await fixture(stream, [malformed, plan([{ function: "send_message", params: { message: "corrected" } }])]);
            expect(await f.run()).toBe(true);
            expect(f.requests).toHaveLength(2);
            expect(f.invocations).toEqual(["corrected"]);
            expect(f.requests[1].messages.slice(0, 2)).toEqual(f.requests[0].messages);
            expect(f.requests[1].messages.at(-2)).toMatchObject({ role: "assistant", content: malformed });
            expect(f.requests[1].messages.at(-1).content).toContain("validation");
        });
    }
    it(`${stream ? "streaming" : "JSON"} preserves omitted params for a zero-argument tool`, async () => {
        const f = await fixture(stream, [plan([{ function: "noop" }])]);
        expect(await f.run()).toBe(false);
        expect(f.requests).toHaveLength(1);
        expect(f.invocations).toEqual(["noop"]);
    });
}
