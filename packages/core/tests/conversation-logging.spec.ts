import { expect, it } from "vitest";

import { StimulusScheduler } from "../src/agent/scheduler";
import { LogLevel, LoggerService } from "../src/logger";
import { withConversationLog } from "../src/logger/conversation";
import { stubCtx } from "./helpers/yesimbot";

const target = (channelId: string, extra = {}) => ({ platform: "onebot", selfId: "bot-01", channelId, ...extra });

it("keeps concurrent reply and tool logs associated with their own targets and rounds", async () => {
    const lines: string[] = [];
    const ctx = stubCtx({}, { logger: () => ({ info: (line: string) => lines.push(line) }) });
    const service = new LoggerService(ctx, { logging: { level: LogLevel.INFO }, errorReporting: {} } as any);
    const model = service.getLogger("model");
    const tool = service.getLogger("tool");
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
        release = resolve;
    });
    await Promise.all([
        withConversationLog(target("group-a", { messageId: "101", isDirect: false }), "round-a", async () => {
            await barrier;
            model.info("response");
        }),
        withConversationLog(target("private:b", { messageId: "102", isDirect: true }), "round-b", async () => {
            await Promise.resolve();
            tool.info("tool result");
            release();
        }),
    ]);
    model.info("global");
    expect(lines).toEqual([
        "[onebot/bot-01/私聊 private:b] [消息 102] [轮次 round-b] tool result",
        "[onebot/bot-01/群聊 group-a] [消息 101] [轮次 round-a] response",
        "global",
    ]);
    await service.stop();
});

it("does not show success logs at the ERROR level", async () => {
    const lines: string[] = [];
    const ctx = stubCtx({}, { logger: () => ({ success: (line: string) => lines.push(line), error: (line: string) => lines.push(line) }) });
    const service = new LoggerService(ctx, { logging: { level: LogLevel.ERROR }, errorReporting: {} } as any);
    const logger = service.getLogger("tool");
    logger.success("success");
    logger.error("failure");
    expect(lines).toEqual(["failure"]);
    await service.stop();
});

it("keeps a queued message's context when the running turn finishes", async () => {
    const lines: string[] = [];
    const ctx = stubCtx(
        {},
        {
            logger: () => ({ debug: (line: string) => lines.push(line) }),
            debounce: (run: (value: any) => unknown) => Object.assign((value: any) => run(value), { dispose() {} }),
        },
    );
    const service = new LoggerService(ctx, { logging: { level: LogLevel.DEBUG }, errorReporting: {} } as any);
    const model = service.getLogger("model");
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
        release = resolve;
    });
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => {
        finish = resolve;
    });
    const scheduler = new StimulusScheduler(
        ctx,
        { debounceMs: 0, newMessageStrategy: "immediate" } as any,
        async (stimulus) => {
            if (stimulus.session.messageId === "101") await barrier;
            model.debug("reply");
            if (stimulus.session.messageId === "102") finish();
        },
        service,
    );
    const schedule = (messageId: string, decisionId: string) => {
        const session = target("same-room", { messageId, isDirect: false });
        scheduler.schedule({ type: "user_message", channelCid: "same-room", session, decisionId } as any);
    };
    schedule("101", "round-a");
    schedule("102", "round-b");
    release();
    await finished;
    expect(lines).toContain("[onebot/bot-01/群聊 same-room] [消息 101] [轮次 round-a] reply");
    expect(lines).toContain("[onebot/bot-01/群聊 same-room] [消息 102] [轮次 round-b] reply");
    expect(lines).toContain("[onebot/bot-01/群聊 same-room] [消息 102] [轮次 round-b] 调度 · 回复正在执行 · 已排队 · 当前回复结束后处理");
    scheduler.dispose();
    await service.stop();
});
