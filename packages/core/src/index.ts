import type { Context, ForkScope } from "koishi";
import { Service, sleep } from "koishi";
import { AgentCore } from "./agent";
import { Config, CONFIG_VERSION, migrateConfig } from "./config";
import {
    AssetService,
    CommandService,
    HorizonService,
    MemoryService,
    ModelService,
    PluginService,
    PromptService,
    TelemetryService,
} from "./services";
import { Services } from "./shared";

declare module "koishi" {
    interface Context {
        yesimbot: YesImBot;
    }
}

export default class YesImBot extends Service<Config> {
    static readonly Config = Config;
    static readonly inject = {
        required: ["console", "database"],
    };

    static readonly name = "yesimbot";
    static readonly usage = `"Yes! I'm Bot!" 是一个能让你的机器人激活灵魂的插件。\n
使用请阅读 [文档](https://docs.yesimbot.chat/) ，推荐使用 [GPTGOD](https://gptgod.online/#/register?invite_code=envrd6lsla9nydtipzrbvid2r) 提供的 \`deepseek-v3\` 模型以获得最高性价比。目前已知效果最佳模型：\`gemini-2.5-pro-preview-06-05\`
\n
官方交流群：[857518324](http://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=k3O5_1kNFJMERGxBOj1ci43jHvLvfru9&authKey=TkOxmhIa6kEQxULtJ0oMVU9FxoY2XNiA%2B7bQ4K%2FNx5%2F8C8ToakYZeDnQjL%2B31Rx%2B&noverify=0&group_code=857518324)\n`;

    constructor(ctx: Context, config: Config) {
        super(ctx, "yesimbot", true);

        const commandService = ctx.plugin(CommandService, config);

        const telemetryService = ctx.plugin(TelemetryService, config.telemetry);

        const telemetry: TelemetryService = ctx.get(Services.Telemetry);

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
                config.version = version;
                const newConfig = migrateConfig(config);

                const validatedConfig = Config(newConfig, { autofix: true });
                ctx.scope.update(validatedConfig, false);
                config = validatedConfig;
                ctx.logger.success("配置迁移成功");
            } catch (error: any) {
                ctx.logger.error("配置迁移失败:", error.message);
                ctx.logger.debug(error);
                telemetry.captureException(error);
            }
        }

        try {
            const assetService = ctx.plugin(AssetService, config);
            const promptService = ctx.plugin(PromptService, config);
            const toolService = ctx.plugin(PluginService, config);
            const modelService = ctx.plugin(ModelService, config);
            const memoryService = ctx.plugin(MemoryService, config);
            const horizonService = ctx.plugin(HorizonService, config);

            const agentCore = ctx.plugin(AgentCore, config);

            const services = [
                agentCore,
                assetService,
                commandService,
                memoryService,
                modelService,
                promptService,
                telemetryService,
                toolService,
                horizonService,
            ];

            waitForServices(services)
                .then(() => {
                    this.ctx.logger.info("所有服务已就绪");
                    // eslint-disable-next-line ts/no-require-imports
                    this.ctx.logger.info(`Version: ${require("../package.json").version}`);
                })
                .catch((err) => {
                    this.ctx.logger.error("服务初始化失败:", err.message);
                    this.ctx.logger.error(err.stack);
                    telemetry.captureException(err);
                    services.forEach((service) => {
                        try {
                            service.dispose();
                        } catch (error: any) {
                            telemetry.captureException(error);
                        }
                    });
                    this.ctx.stop();
                });
        } catch (err: any) {
            this.ctx.logger.error("初始化时发生错误:", err.message);
            this.ctx.logger.error(err.stack);
            telemetry.captureException(err);
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
                setTimeout(check, 1000);
            }
        };
        check();
    });
}

export * from "./services";
export * from "./shared";
