import { Context, Service } from "koishi";

import AgentCore from "./agent/agent";
import { Config } from "./config";
import { MemoryService, ModelService, PromptBuilder, ToolService, WorldStateService } from "./services";
import {
    ChatMessage,
    IMAGE_TABLE,
    ImageData,
    Interaction,
    INTERACTION_TABLE,
    LAST_REPLY_TABLE,
    MEMORY_TABLE,
    MemoryBlockData,
    MESSAGE_TABLE,
} from "./shared";

declare module "koishi" {
    interface Context {
        yesimbot: YesImBot;
    }
}

declare module "koishi" {
    interface Tables {
        [MESSAGE_TABLE]: ChatMessage;
        [MEMORY_TABLE]: MemoryBlockData;
        [INTERACTION_TABLE]: Interaction;
        [LAST_REPLY_TABLE]: {
            channelId: string;
            timestamp: Date;
        };
        [IMAGE_TABLE]: ImageData;
    }
}

export default class YesImBot extends Service {
    static readonly Config = Config;
    static readonly inject = {
        required: ["console", "database"],
    };
    static readonly name = "yesimbot";
    static readonly usage = `"Yes! I'm Bot!" 是一个能让你的机器人激活灵魂的插件。\n
使用请阅读 [Github README](https://github.com/HydroGest/YesImBot/blob/main/readme.md)，推荐使用 [GPTGOD](https://gptgod.online/#/register?invite_code=envrd6lsla9nydtipzrbvid2r) 提供的 llama-3.1-405b 模型以获得最高性价比。\n
官方交流 & 测试群：[857518324](http://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=k3O5_1kNFJMERGxBOj1ci43jHvLvfru9&authKey=TkOxmhIa6kEQxULtJ0oMVU9FxoY2XNiA%2B7bQ4K%2FNx5%2F8C8ToakYZeDnQjL%2B31Rx%2B&noverify=0&group_code=857518324)`;
    constructor(ctx: Context, config: Config) {
        super(ctx, "yesimbot", true);

        // 本地化
        ctx.i18n.define("en-US", require("./locales/en-US"));
        ctx.i18n.define("zh-CN", require("./locales/zh-CN"));

        // 注册工具管理器
        ctx.plugin(ToolService, config.ToolServiceConfig);

        // 注册模型服务
        ctx.plugin(ModelService, config.ModelServiceConfig);

        // 注册记忆管理层
        ctx.plugin(MemoryService, config.Memory);

        // 注册 WorldState 服务
        this.ctx.plugin(WorldStateService, config.WorldState);

        // 注册提示词构建器服务
        this.ctx.plugin(PromptBuilder, config.PromptTemplate);

        this.registerTables();

        ctx.on("ready", async () => {
            // 注册指令
            ctx.plugin(require("./commands/cache"));
            ctx.plugin(require("./commands/config"), config);
            ctx.plugin(require("./commands/extension"));

            ctx.plugin(AgentCore, config);
        });
    }

    /**
     * 注册所有数据库表
     */
    public registerTables(): void {
        this.registerMessageTable();
        this.registerInteractionTable();
        this.registerLastReplyTable();
        this.registerImageTable();

        this.ctx.logger.info("[DatabaseManager] 所有数据库表注册完成");
    }

    private registerMessageTable(): void {
        this.ctx.model.extend(
            MESSAGE_TABLE,
            {
                messageId: "string",
                sender: "object",
                channel: "object",
                timestamp: "timestamp",
                content: "string",
            },
            {
                primary: ["messageId"],
                autoInc: false,
            }
        );
    }

    private registerInteractionTable(): void {
        this.ctx.model.extend(
            INTERACTION_TABLE,
            {
                id: "string",
                emitter: "string",
                emitter_channel_id: "string",
                type: "string",
                functionName: "string",
                toolParams: "json",
                toolResult: "object",
                life: "integer",
                timestamp: "timestamp",
            },
            {
                primary: "id",
            }
        );
    }

    private registerLastReplyTable(): void {
        this.ctx.model.extend(
            LAST_REPLY_TABLE,
            {
                channelId: "string",
                timestamp: "timestamp",
            },
            {
                primary: "channelId",
                autoInc: false,
            }
        );
    }

    private registerImageTable(): void {
        this.ctx.model.extend(
            IMAGE_TABLE,
            {
                id: "string",
                mimeType: "string",
                base64: "string",
                summary: "string",
                desc: "string",
                size: "integer",
                timestamp: "timestamp",
            },
            {
                primary: "id",
                autoInc: false,
            }
        );
    }
}
