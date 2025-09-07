import {} from "@koishijs/plugin-notifier";
import { Context, ForkScope, Service, sleep } from "koishi";

import { AgentCore } from "./agent";
import { Config } from "./config";
import { AssetService, LoggerService, MemoryService, ModelService, PromptService, ToolService, WorldStateService } from "./services";
import { handleError, initializeErrorReporter } from "./shared/errors";
import * as ConfigCommand from "./commands/config";

declare module "koishi" {
    interface Context {
        yesimbot: YesImBot;
    }
}

export default class YesImBot extends Service<Config> {
    static readonly Config = Config;
    static readonly inject = {
        required: ["console", "database", "notifier"],
        optional: ["puppeteer"],
    };
    static readonly name = "yesimbot";
    static readonly usage = `"Yes! I'm Bot!" 是一个能让你的机器人激活灵魂的插件。\n
使用请阅读 [文档](https://docs.yesimbot.chat/) ，推荐使用 [GPTGOD](https://gptgod.online/#/register?invite_code=envrd6lsla9nydtipzrbvid2r) 提供的 \`deepseek-v3\` 模型以获得最高性价比。目前已知效果最佳模型：\`gemini-2.5-pro-preview-06-05\`
\n
官方交流群：[857518324](http://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=k3O5_1kNFJMERGxBOj1ci43jHvLvfru9&authKey=TkOxmhIa6kEQxULtJ0oMVU9FxoY2XNiA%2B7bQ4K%2FNx5%2F8C8ToakYZeDnQjL%2B31Rx%2B&noverify=0&group_code=857518324)\n`;
    constructor(ctx: Context, config: Config) {
        super(ctx, "yesimbot", true);

        try {
            ctx.plugin(ConfigCommand);

            // 注册日志服务
            const loggerService = ctx.plugin(LoggerService, config);

            // 注册资源中心服务
            const assetService = ctx.plugin(AssetService, config);

            // 注册提示词管理器
            const promptService = ctx.plugin(PromptService, config);

            // 注册工具管理器
            const toolService = ctx.plugin(ToolService, config);

            // 注册模型服务
            const modelService = ctx.plugin(ModelService, config);

            // 注册记忆管理层
            const memoryService = ctx.plugin(MemoryService, config);

            // 注册 WorldState 服务
            const worldStateService = ctx.plugin(WorldStateService, config);

            const agentCore = ctx.plugin(AgentCore, config);

            const services = [
                loggerService,
                assetService,
                promptService,
                toolService,
                modelService,
                memoryService,
                worldStateService,
                agentCore,
            ];

            initializeErrorReporter(config.system.errorReporting, this.ctx.logger("[错误报告]"));

            waitForServices(services)
                .then(() => {
                    this.ctx.logger.info("所有服务已就绪");
                    this.ctx.logger.info(`Version: ${require("../package.json").version}`);
                })
                .catch((err) => {
                    this.ctx.logger.error(err.message);
                    ctx.notifier.create("初始化时发生错误");
                    // services.forEach((service) => {
                    //     try {
                    //         service.dispose();
                    //     } catch (error) {
                    //     }
                    // });
                });
        } catch (error) {
            ctx.notifier.create("初始化时发生错误");
            // this.ctx.logger.error("初始化时发生错误:", error.message);
            // this.ctx.logger.error(error.stack);
            handleError(this.ctx.logger("yesimbot"), error, "初始化时发生错误");
            this.ctx.stop();
        }
    }
}

async function waitForServices(services: ForkScope[]) {
    await sleep(1000);

    // 未就绪服务
    const notReadyServices = new Set(services.map((service) => service.ctx.name));

    return new Promise<void>((resolve, reject) => {
        setTimeout(() => {
            if (!services.every((service) => service.ready)) {
                reject(new Error(`服务初始化超时: ${Array.from(notReadyServices).join(", ")}`));
            }
        }, 10000);
        const check = () => {
            for (const service of services) {
                if (service.ready && notReadyServices.has(service.ctx.name)) {
                    notReadyServices.delete(service.ctx.name);
                }
            }
            if (notReadyServices.size === 0) {
                resolve();
            } else {
                setTimeout(check, 100);
            }
        };
        check();
    });
}

export * from "./services";
export * from "./shared";
