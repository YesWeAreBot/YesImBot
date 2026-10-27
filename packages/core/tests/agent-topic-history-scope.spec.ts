import { expect, it } from "vitest";

import { replyKey } from "../src/agent/reply-control";
import { TopicManager } from "../src/agent/topics";
import { TypeSafeEvaluator } from "../src/agent/typesafe";
import { loggingStub, stubCtx } from "./helpers/yesimbot";

for (const mode of ["typesafe", "topics"]) {
    it(`limits ${mode} recent history to the current Telegram group/topic`, async () => {
        const queries: string[] = [],
            inputs: any[] = [];
        const ctx = stubCtx(
            { logging: loggingStub() },
            {
                database: {
                    get: async (_table: string, query: any) => {
                        queries.push(query.channelId);
                        return [{ id: "earlier", sender: { id: "u" }, content: `history:${query.channelId}` }];
                    },
                },
            },
        );
        const config: any = {
            enabled: true,
            mode: "adjust",
            model: { providerName: "p", modelId: "m" },
            evaluationModel: { providerName: "p", modelId: "m" },
            timeoutMs: 1000,
            historyLimit: 2,
            interests: "x",
            influence: 0.5,
            minIntervalMs: 0,
            messagesPerAnalysis: 1,
            maxTopics: 4,
            idleTimeoutSeconds: 1,
        };
        const model: any = {
            getEvaluationModel: () => ({
                evaluate: async (input: any) => {
                    inputs.push(input);
                    return { answers: { addressed: { noul: 1 }, interested: { noul: 0 }, others: { noul: 0 } } };
                },
            }),
            getChatModel: () => ({
                chat: async (options: any) => {
                    inputs.push(JSON.parse(options.messages.at(-1).content));
                    return { text: JSON.stringify({ topics: [{ id: "t", label: "t", share: 1, interest: 0.5 }], currentTopicId: "t" }) };
                },
            }),
        };
        const evaluator = new TypeSafeEvaluator(ctx, { typesafe: config } as any, model);
        const topics = new TopicManager(ctx, config, { logging: loggingStub(), model });
        try {
            for (const guildId of ["-10001", "-10002"]) {
                const session: any = {
                    platform: "telegram",
                    selfId: "bot",
                    channelId: "7",
                    guildId,
                    isDirect: false,
                    bot: { selfId: "bot" },
                    messageId: "current",
                    content: "hello",
                    timestamp: Date.now(),
                    toJSON: () => ({ message: { content: "hello" } }),
                };
                if (mode === "typesafe") await evaluator.evaluate(session, new AbortController().signal);
                else await topics.assess(session, replyKey(session), new AbortController().signal);
                expect(session.channelId).toBe("7");
            }
            expect(queries).toEqual(['telegram-topic:["-10001","7"]', 'telegram-topic:["-10002","7"]']);
            expect(inputs).toHaveLength(2);
            expect(inputs.map((input) => input.recentMessages[0].content)).toEqual(queries.map((key) => `history:${key}`));
        } finally {
            topics.dispose();
        }
    });
}

it("binds heartbeat clear watches and all interaction writes to canonical topic identity", async () => {
    const { HeartbeatProcessor } = await import("../src/agent/heartbeat-processor");
    const processor: any = Object.create(HeartbeatProcessor.prototype);
    const watched: string[] = [],
        written: string[] = [],
        transported: any[] = [];
    const logger = { info() {}, debug() {}, error() {}, warn() {}, success() {} };
    Object.assign(processor, {
        config: { heartbeat: 1 },
        logger,
        world: {
            l2_manager: {
                getHistoryGeneration: () => 0,
                watchHistory: (target: any) => {
                    watched.push(target.channelId);
                    return () => {};
                },
            },
        },
        interactionManager: {
            recordThought: async (_turn: string, _platform: string, channelId: string) => {
                written.push(channelId);
            },
            recordAction: async (_turn: string, _platform: string, channelId: string) => {
                written.push(channelId);
                return "action";
            },
            recordObservation: async (_action: string, _platform: string, channelId: string) => {
                written.push(channelId);
            },
        },
        modelSwitcher: {
            chat: async () => ({
                text: JSON.stringify({
                    thoughts: { observe: "x", analyze_infer: "x", plan: "x" },
                    actions: [{ function: "send_message", params: { message: "x" } }],
                    request_heartbeat: false,
                }),
            }),
        },
        toolService: {
            invoke: async (_name: string, _params: any, session: any) => {
                transported.push([session.channelId, session.guildId]);
                return { status: "success" };
            },
        },
        contextBuilder: { commitMultimodalUsage() {} },
        _prepareLlmRequest: async () => ({ messages: [], manualRecallIds: [] }),
    });
    for (const guildId of ["-10001", "-10002"]) {
        const session: any = { platform: "telegram", selfId: "bot", channelId: "7", guildId, cid: "telegram:7", bot: { platform: "telegram", selfId: "bot" } };
        expect(await processor.runCycle({ type: "user_message", session })).toBe(true);
    }
    expect(watched).toEqual(['telegram-topic:["-10001","7"]', 'telegram-topic:["-10002","7"]']);
    expect(written).toEqual(watched.flatMap((channelId) => [channelId, channelId, channelId]));
    expect(transported).toEqual([
        ["7", "-10001"],
        ["7", "-10002"],
    ]);
});
