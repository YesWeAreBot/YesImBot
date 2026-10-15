import { Context } from "koishi";

import { Config } from "../config";

/**
 * YesImBot 子服务基类。
 *
 * 子服务不再是独立的 Koishi Service，而是由 {@link YesImBot} 持有并暴露为成员的普通类实例，
 * 外部统一通过 `ctx.yesimbot.<name>` 访问（如 `ctx.yesimbot.asset`、`ctx.yesimbot.model`）。
 *
 * 依赖一律通过构造参数注入：`ctx.yesimbot` 要到 YesImBot 构造函数返回、Koishi 完成服务注册
 * 之后才可用，构造函数中读取它只会拿到未初始化状态。生命周期由 YesImBot 负责：全部子服务
 * 构造完成后按依赖顺序调用 `start()`，插件卸载时按相反顺序调用 `stop()`。
 */
export abstract class YesImBotService<C = Config> {
    constructor(
        public readonly ctx: Context,
        public readonly config: C,
    ) {}

    /** 由 YesImBot 按依赖顺序调用。 */
    public start(): void | Promise<void> {}

    /** 由 YesImBot 在插件卸载时按相反顺序调用，用于释放定时器、监听与外部句柄。 */
    public stop(): void | Promise<void> {}
}
