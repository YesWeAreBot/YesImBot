import { Context, Logger } from "koishi";

import type { LoggerService } from "../../src/logger";

/** 桩对象：测试只关心被测代码实际读取的那几个成员。 */
type Stub = Record<string, unknown>;

/**
 * 测试用的日志服务桩：`getLogger` 始终返回同一个 logger 桩。
 *
 * 服务依赖改为构造注入后，测试直接用桩替代真实的 `LoggerService`。
 */
export function loggingStub(logger: unknown = { debug() {}, info() {}, warn() {}, error() {}, success() {} }) {
    return { getLogger: () => logger } as unknown as LoggerService;
}

/**
 * 测试用的 `ctx.yesimbot` 外观。
 *
 * 子服务不再是独立的 Koishi Service，而是 `YesImBot` 持有的普通类成员，
 * 被测代码统一通过 `ctx.yesimbot.<name>` 读取。默认值只是占位桩，
 * 需要断言行为的成员通过 `members` 覆盖。
 */
export interface YesImBotFacade {
    logging: { getLogger: (name?: string) => unknown };
    asset: Stub;
    prompt: Stub;
    memory: Stub;
    model: Stub;
    world: Stub;
    tool: Stub;
    agent: Stub;
}

export function stubYesImBot(members: Partial<YesImBotFacade> = {}): YesImBotFacade {
    return {
        logging: { getLogger: () => new Logger("test") },
        asset: {},
        prompt: {},
        memory: {},
        model: {},
        world: {},
        tool: {},
        agent: {},
        ...members,
    };
}

/**
 * 构造带 `yesimbot` 外观的 ctx 桩。
 *
 * `extra` 用于补充 koishi 侧的字面成员（`on()`、`database`、`debounce` 等）。
 * 被测类的构造签名仍是 `Context`，因此这里做一次测试边界上的显式转换：
 * 桩 ctx 只实现被测路径读取到的成员，无法满足完整 Context 契约。
 */
export function stubCtx<T extends object = {}>(members: Partial<YesImBotFacade> = {}, extra?: T): Context & T {
    const ctx = { yesimbot: stubYesImBot(members), ...extra };
    return ctx as unknown as Context & T;
}
