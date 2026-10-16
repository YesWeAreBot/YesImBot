import { expect, it } from "vitest";

import { TypeSafeEvaluator } from "../src/agent/typesafe";
import { loggingStub, stubCtx } from "./helpers/yesimbot";

it.each([
    { mode: "adjust", returnedModel: "served-model", expectedModel: "served-model" },
    { mode: "observe", returnedModel: "served-model", expectedModel: "served-model" },
    { mode: "adjust", returnedModel: "x".repeat(128) + "private-tail-marker", expectedModel: "x".repeat(128) + "…" },
    { mode: "adjust", returnedModel: undefined, expectedModel: "未提供" },
    { mode: "adjust", returnedModel: { secret: "private-tail-marker" }, expectedModel: "未提供" },
])("shows safe TypeSafe answer details in ordinary logs ($mode, $expectedModel)", async ({ mode, returnedModel, expectedModel }) => {
    const info: string[] = [];
    const ctx = stubCtx({
        logging: loggingStub({ debug() {}, info: (message: string) => info.push(message), warn() {} }),
    });
    const evaluator = new TypeSafeEvaluator(
        ctx,
        {
            typesafe: {
                mode,
                evaluationModel: { providerName: "jev", modelId: "selected-model" },
                timeoutMs: 1000,
                historyLimit: 0,
                interests: "private-interests-marker",
                influence: 0.5,
            },
        } as any,
        {
            getEvaluationModel: () => ({
                evaluate: async () => ({
                    model: returnedModel,
                    answers: {
                        addressed: { type: "noul", noul: 0.9 },
                        interested: { type: "noul", noul: 0.3 },
                        others: { type: "noul", noul: 0.6 },
                    },
                    debug: { apiKey: "private-credential-marker" },
                }),
            }),
        } as any,
    );
    const session: any = {
        platform: "onebot",
        selfId: "bot",
        channelId: "group",
        userId: "user",
        messageId: "message",
        bot: { selfId: "bot" },
        content: "private-conversation-marker",
        toJSON: () => ({ message: { content: "private-conversation-marker" } }),
    };

    expect(await evaluator.evaluate(session, new AbortController().signal)).toBeCloseTo(1.3);

    const output = info.join("\n");
    expect(output).toContain("[jev][selected-model]");
    expect(output).toContain(`返回模型: ${JSON.stringify(expectedModel)}`);
    expect(output).not.toContain("private-tail-marker");
    expect(output).toContain("对我说: 0.900");
    expect(output).toContain("兴趣匹配: 0.300");
    expect(output).toContain("对别人说: 0.600");
    expect(output).toContain("结果倍率: 1.300");
    expect(output).toMatch(/耗时: \d+ms/);
    expect(output).toContain(mode === "adjust" ? "用于调整意愿" : "仅观察，不调整意愿");
    expect(output).not.toContain("private-conversation-marker");
    expect(output).not.toContain("private-interests-marker");
    expect(output).not.toContain("private-credential-marker");
});
