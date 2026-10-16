import path from "node:path";

import type {} from "@koishijs/plugin-console";
import type {} from "@koishijs/plugin-notifier";
import { Context, Service } from "koishi";

import { AgentCore } from "./agent";
import { AssetService } from "./asset";
import * as ConfigCommand from "./commands/config";
import { Config, CONFIG_VERSION, migrateConfig } from "./config";
import { ToolService } from "./extension";
import { LoggerService } from "./logger";
import { MemoryService } from "./memory";
import { ModelService } from "./model";
import { PromptService } from "./prompt";
import { handleError } from "./shared/errors";
import { YesImBotService } from "./shared/service";
import { WorldStateService } from "./world";

declare module "koishi" {
    interface Context {
        yesimbot: YesImBot;
    }
}

export default class YesImBot extends Service<Config> {
    static readonly Config = Config;
    static readonly inject = {
        required: ["console", "database", "notifier", "server", "http"],
        optional: ["puppeteer"],
    };
    static readonly name = "yesimbot";
    static readonly usage = `"Yes! I'm Bot!" 是一个能让你的机器人激活灵魂的插件。\n
使用请阅读 [文档](https://docs.yesimbot.chat/) ，推荐使用 [GPTGOD](https://gptgod.online/#/register?invite_code=envrd6lsla9nydtipzrbvid2r) 提供的 \`deepseek-v3\` 模型以获得最高性价比。目前已知效果最佳模型：\`gemini-2.5-pro-preview-06-05\`
\n
官方交流群：[857518324](http://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=k3O5_1kNFJMERGxBOj1ci43jHvLvfru9&authKey=TkOxmhIa6kEQxULtJ0oMVU9FxoY2XNiA%2B7bQ4K%2FNx5%2F8C8ToakYZeDnQjL%2B31Rx%2B&noverify=0&group_code=857518324)\n`;

    /**
     * 日志服务。命名为 `logging` 而非 `logger`，避免与 Koishi `Service` 上已废弃的
     * `logger: Logger` 成员冲突（派生类成员类型必须兼容基类）。
     */
    public readonly logging: LoggerService;
    public readonly asset: AssetService;
    public readonly prompt: PromptService;
    public readonly memory: MemoryService;
    public readonly model: ModelService;
    public readonly world: WorldStateService;
    public readonly tool: ToolService;
    public readonly agent: AgentCore;

    /** 子服务实例，按依赖顺序排列：即构造顺序与启动顺序，卸载时反向停止。 */
    private readonly services: YesImBotService[];
    private stopping = false;
    private stopPromise?: Promise<void>;

    /** 全部子服务启动流程结束后兑现（失败时已记录日志并通知，不向外抛出）。 */
    public readonly ready: Promise<void>;

    constructor(ctx: Context, config: Config) {
        super(ctx, "yesimbot", true);

        ctx.console.addEntry({
            dev: path.resolve(__dirname, "../client/index.ts"),
            prod: path.resolve(__dirname, "../dist"),
        });

        let version = config.version;
        const hasLegacyV1Field = Object.hasOwn(config, "modelService");

        if (!version) {
            if (hasLegacyV1Field) {
                ctx.logger.info("检测到 v1 版本配置，将尝试迁移");
                version = "1.0.0";
            } else {
                ctx.logger.info("未找到版本号，将视为最新版本配置");
                version = CONFIG_VERSION;
                // 写入配置版本号
                ctx.scope.update({ ...config, version }, false);
            }
        }

        if (version !== CONFIG_VERSION) {
            try {
                // @ts-ignore
                config.version = version;
                const newConfig = migrateConfig(config);

                const validatedConfig = Config(newConfig, { autofix: true });
                ctx.scope.update(validatedConfig, false);
                config = validatedConfig;
                ctx.logger.success("配置迁移成功");
            } catch (error) {
                ctx.logger.error("配置迁移失败:", error.message);
                ctx.logger.debug(error);
            }
        }

        this.config = config;

        ctx.plugin(ConfigCommand, config);

        // 子服务由 YesImBot 直接持有，不再注册为独立的 Koishi 服务。
        // 依赖通过构造参数注入：构造期间 `ctx.yesimbot` 尚未注册，任何服务都不得在
        // 初始化阶段读取它。构造顺序即依赖顺序，与下方 services 数组、启动顺序一致。
        this.logging = new LoggerService(ctx, config);
        this.asset = new AssetService(ctx, config, this.logging);
        this.prompt = new PromptService(ctx, config, this.logging);
        this.memory = new MemoryService(ctx, config, this.logging);
        this.model = new ModelService(ctx, config, this.logging);
        this.world = new WorldStateService(ctx, config, { logging: this.logging, asset: this.asset, model: this.model });
        this.tool = new ToolService(ctx, config, { logging: this.logging, prompt: this.prompt, world: this.world });
        this.agent = new AgentCore(ctx, config, {
            logging: this.logging,
            world: this.world,
            model: this.model,
            prompt: this.prompt,
            tool: this.tool,
            asset: this.asset,
            memory: this.memory,
        });

        this.services = [this.logging, this.asset, this.prompt, this.memory, this.model, this.world, this.tool, this.agent];

        this.ctx.on("dispose", () => this.stopServices());

        this.ready = this.startServices();
    }

    private async startServices(): Promise<void> {
        try {
            for (const service of this.services) {
                if (this.stopping) return;
                await service.start();
                if (this.stopping) return;
            }
            this.ctx.logger.info("所有服务已就绪");
            this.ctx.logger.info(`Version: ${require("../package.json").version}`);
        } catch (error) {
            if (this.stopping) return;
            this.ctx.logger.error(error.message);
            this.ctx.notifier.create("初始化时发生错误");
            handleError(this.logging.getLogger("yesimbot"), error, "服务初始化时发生错误");
        }
    }

    private stopServices(): Promise<void> {
        if (this.stopPromise) return this.stopPromise;
        // Fence startup synchronously, then let its in-flight operation settle
        // before cleanup. Otherwise an await inside start() can recreate resources
        // after stop() has already released them.
        this.stopping = true;
        this.stopPromise = (async () => {
            await this.ready;
            for (const service of [...this.services].reverse()) {
                try {
                    await service.stop();
                } catch (error) {
                    this.ctx.logger.error(error?.message ?? String(error));
                }
            }
        })();
        return this.stopPromise;
    }
}

export * from "./asset";
export * from "./extension";
export * from "./logger";
export * from "./memory";
export * from "./model";
export * from "./prompt";
export * from "./shared";
export * from "./world";
