import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import type { ExtensionAPI, ToolDefinition } from "@yesimbot/agent/session";
import { Context, Logger, Schema, Service } from "koishi";
import type { AthenaExtensionDefinition, ChannelContext } from "koishi-plugin-yesimbot";
import { encodeChannelId } from "koishi-plugin-yesimbot";

import { createListSessionsTool, createSearchSessionTool } from "./tools.js";
import type { SessionContextConfig } from "./types.js";

export interface SessionContextPluginConfig {
  sessionsDir: string;
  isolation: boolean;
  defaultLimit: number;
  maxLimit: number;
}

export default class SessionContextPlugin extends Service<SessionContextPluginConfig> {
  static name = "yesimbot.session-context";
  static inject = ["yesimbot.extension"];

  static Config: Schema<SessionContextPluginConfig> = Schema.object({
    sessionsDir: Schema.path({ filters: ["directory"], allowCreate: true })
      .default("data/yesimbot/sessions")
      .description("会话文件根目录（相对于 koishi app 目录）"),
    isolation: Schema.boolean().default(true).description("隔离模式：true 只允许访问当前频道"),
    defaultLimit: Schema.number().default(20).description("search_session 默认返回条数"),
    maxLimit: Schema.number().default(100).description("search_session 最大返回条数"),
  });

  readonly logger: Logger;

  constructor(ctx: Context, config: SessionContextPluginConfig) {
    super(ctx, "yesimbot.session-context");
    this.logger = ctx.logger("session-context");
    this.config = config;
  }

  async start(): Promise<void> {
    this.logger.info("Starting session-context plugin...");

    const sessionsDir = resolve(this.ctx.baseDir, this.config.sessionsDir);
    if (!existsSync(sessionsDir)) {
      mkdirSync(sessionsDir, { recursive: true });
    }

    const config: SessionContextConfig = {
      sessionsDir,
      isolation: this.config.isolation,
      defaultLimit: this.config.defaultLimit,
      maxLimit: this.config.maxLimit,
    };

    const logger = this.logger;

    this.ctx["yesimbot.extension"].registerExtension({
      id: "session-context",
      setup(api: ExtensionAPI, context?: ChannelContext) {
        const channelKey = context ? encodeChannelId(context.platform, context.channelId) : "";

        const isolationLabel = config.isolation ? "隔离模式" : "共享模式";
        const scopeDesc = config.isolation ? `当前频道 (${channelKey})` : "所有频道";

        const sessionPrompt = `
=== 会话检索能力 ===

你拥有搜索历史会话记录的能力（${isolationLabel}，范围：${scopeDesc}）。

<可用工具>
1. search_session — 按关键词和过滤条件搜索历史消息
   - keyword: 正则表达式（大小写不敏感）
   - since/until: ISO 8601 时间范围
   - user: 按发送者 ID 过滤
   - limit: 返回条数（默认 ${config.defaultLimit}，最大 ${config.maxLimit}）
   ${config.isolation ? "" : '- channelKey: 目标频道 key（如 "onebot:123456"），默认当前频道'}

2. list_sessions — 列出可用频道和会话文件
   ${config.isolation ? "（隔离模式下仅显示当前频道）" : "- 可指定 channelKey 查看特定频道，不指定则列出所有频道"}

</可用工具>

<使用场景>
- 用户问"之前聊过什么"、"上次说了什么" → 用 search_session
- 用户要求回顾某个话题 → search_session + keyword
- 用户要求查看特定时间的消息 → search_session + since/until
- 需要了解有哪些频道或会话 → list_sessions
</使用场景>

<重要：会话检索噪声过滤>
1. 优先用 keyword 精确搜索，不要无条件列出所有会话
2. 结果中已过滤工具调用/结果，只包含用户消息和助手文本回复
3. 每条结果内容截断为 500 字符，如需完整内容请用 sessionId 定位后读取文件
</重要：会话检索噪声过滤>
`;

        api.on("agent:before-start", (event) => {
          return {
            systemPrompt: event.systemPrompt + sessionPrompt,
          };
        });

        logger.info("Registering session-context tools...");

        const searchTool = createSearchSessionTool(config, channelKey);
        api.registerTool(searchTool as ToolDefinition);
        logger.info(`Registered tool: ${searchTool.name}`);

        const listTool = createListSessionsTool(config, channelKey);
        api.registerTool(listTool as ToolDefinition);
        logger.info(`Registered tool: ${listTool.name}`);

        return {
          dispose() {
            logger.info("Session-context extension disposed");
          },
        };
      },
    } as AthenaExtensionDefinition);

    this.logger.success("Session-context plugin started");
  }

  async stop(): Promise<void> {
    this.ctx["yesimbot.extension"].unregisterExtension("session-context");
    this.logger.info("Session-context plugin stopped");
  }
}
