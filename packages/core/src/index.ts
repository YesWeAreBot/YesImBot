import { Context, ForkScope, Service, sleep } from "koishi";
import { AgentCore } from "./agent";
import { ConfiguratorService } from "./commands/configurator";
import { Config } from "./config";
import { AssetService, LoggerService, MemoryService, ModelService, PromptService, ToolService, WorldStateService } from "./services";
import { handleError, initializeErrorReporter } from "./shared/errors";

declare module "koishi" {
    interface Context {
        yesimbot: YesImBot;
    }
}

export default class YesImBot extends Service<Config> {
    static readonly Config = Config;
    static readonly inject = {
        required: ["console", "database"],
        optional: ["puppeteer"],
    };
    static readonly name = "yesimbot";
    static readonly usage = `"Yes! I'm Bot!" 是一个能让你的机器人激活灵魂的插件。\n
使用请阅读 [文档](https://docs.yesimbot.chat/) ，推荐使用 [GPTGOD](https://gptgod.online/#/register?invite_code=envrd6lsla9nydtipzrbvid2r) 提供的 \`deepseek-v3\` 模型以获得最高性价比。目前已知效果最佳模型：\`gemini-2.5-pro-preview-06-05
\`\n
官方交流群：[857518324](http://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=k3O5_1kNFJMERGxBOj1ci43jHvLvfru9&authKey=TkOxmhIa6kEQxULtJ0oMVU9FxoY2XNiA%2B7bQ4K%2FNx5%2F8C8ToakYZeDnQjL%2B31Rx%2B&noverify=0&group_code=857518324)\n`;
    constructor(ctx: Context, config: Config) {
        super(ctx, "yesimbot", true);

        try {
            // 注册日志服务
            const loggerService = ctx.plugin(LoggerService, config.system.logging);

            // 注册资源中心服务
            const assetService = ctx.plugin(AssetService, config.assetService);

            // 注册提示词管理器
            const promptService = ctx.plugin(PromptService, config.promptService);

            // 注册工具管理器
            const toolService = ctx.plugin(ToolService, { ...config.capabilities.tools, system: config.system });

            // 注册模型服务
            const modelService = ctx.plugin(ModelService, { ...config.modelService, system: config.system });

            // 注册记忆管理层
            const memoryService = ctx.plugin(MemoryService, { ...config.capabilities.memory, system: config.system });

            // 注册 WorldState 服务
            const worldStateService = ctx.plugin(WorldStateService, {
                ...config.capabilities.history,
                allowedChannels: config.agentBehavior.arousal.allowedChannels,
                system: config.system,
            });

            const agentCore = ctx.plugin(AgentCore, { ...config.agentBehavior, system: config.system });

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

            waitForServices(services).then(() => {
                this.ctx.logger.info("所有服务已就绪");
                this.ctx.logger.info(`Version: ${require("../package.json").version}`);
            });
        } catch (error) {
            // this.ctx.logger.error("初始化时发生错误:", error.message);
            // this.ctx.logger.error(error.stack);
            handleError(this.ctx.logger("[YesImBot]"), error, "初始化时发生错误");
            this.ctx.stop();
        }

        ctx.plugin(ConfiguratorService, config);
    }
}

async function waitForServices(services: ForkScope[]) {
    await sleep(1000);
    return new Promise<void>((resolve) => {
        const check = () => {
            if (services.every((service) => service.ready)) {
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
