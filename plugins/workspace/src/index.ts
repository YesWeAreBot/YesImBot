import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import type { ExtensionAPI, ToolDefinition } from "@yesimbot/agent/session";
import { Context, Logger, Schema, Service } from "koishi";
import type { AthenaExtensionDefinition, ChannelContext } from "koishi-plugin-yesimbot";
import { encodeChannelId } from "koishi-plugin-yesimbot";

import { createWorkspaceTools } from "./tools";
import type { WorkspaceConfig } from "./types";
import { Workspace } from "./workspace";

export interface WorkspacePluginConfig {
  root: string;
  cwd: string;
  persistPaths?: Record<string, string>;
  timeoutMs?: number;
  enableNetwork?: boolean;
  enableMemory?: boolean;
  enablePython?: boolean;
  enableJavascript?: boolean;
  sessionIsolation?: boolean;
}

export default class WorkspacePlugin extends Service<WorkspacePluginConfig> {
  static name = "yesimbot.workspace";
  static inject = ["yesimbot.extension"];

  static Config: Schema<WorkspacePluginConfig> = Schema.object({
    root: Schema.path({ filters: ["directory"], allowCreate: true })
      .default("data/yesimbot/workspace")
      .description("工作区根目录"),
    cwd: Schema.string().default("/home/workspace").description("虚拟文件系统默认目录"),
    persistPaths: Schema.dict(
      Schema.path({ filters: ["directory", "file"], allowCreate: true }),
    ).description("持久化路径映射"),
    timeoutMs: Schema.number().default(30000).description("命令执行超时（毫秒）"),
    enableNetwork: Schema.boolean().default(false).description("启用网络访问"),
    enableMemory: Schema.boolean().default(true).description("启用记忆增强（文件记忆 + 会话日志）"),
    sessionIsolation: Schema.boolean()
      .default(true)
      .description("会话隔离模式（只挂载当前频道目录）"),
    /**
     * Python and JavaScript execution are disabled due to wasm loader issues in the current environment.
     * https://github.com/vercel-labs/just-bash/issues/159
     */
    // enablePython: Schema.boolean().default(false).description("启用 Python 执行"),
    // enableJavascript: Schema.boolean().default(false).description("启用 JavaScript 执行"),
  });

  private ws?: Workspace;
  readonly logger: Logger;

  constructor(ctx: Context, config: WorkspacePluginConfig) {
    super(ctx, "yesimbot.workspace");
    this.logger = ctx.logger("workspace");
    this.config = config;
  }

  async start(): Promise<void> {
    this.logger.info("Starting workspace plugin...");

    const root = resolve(this.ctx.baseDir, this.config.root);
    const persistPaths: Record<string, string> = {};

    for (const [virtualPath, hostPath] of Object.entries(this.config.persistPaths || {})) {
      persistPaths[virtualPath] = resolve(this.ctx.baseDir, hostPath);
    }

    if (!existsSync(root)) {
      mkdirSync(root, { recursive: true });
    }

    for (const hostPath of Object.values(persistPaths)) {
      if (!existsSync(hostPath)) {
        mkdirSync(hostPath, { recursive: true });
      }
    }

    const sessionsDir = resolve(this.ctx.baseDir, "data/yesimbot/sessions");
    if (!existsSync(sessionsDir)) {
      mkdirSync(sessionsDir, { recursive: true });
    }

    this.logger.info(`Workspace root: ${root}`);
    this.logger.info(`Persist paths: ${JSON.stringify(persistPaths, null, 2)}`);

    const sessionIsolation = this.config.sessionIsolation ?? true;

    const workspaceConfig: WorkspaceConfig = {
      root,
      filesystem: {
        persistPaths,
        readOnlyPaths: {
          "/data/sessions": sessionsDir,
        },
      },
      bash: {
        cwd: this.config.cwd,
        timeoutMs: this.config.timeoutMs,
        network: this.config.enableNetwork ? {} : undefined,
        // python: this.config.enablePython,
        // javascript: this.config.enableJavascript,
      },
      sessionIsolation,
    };

    this.ws = new Workspace(workspaceConfig);
    await this.ws.init();

    const workspace = this.ws;
    const logger = this.logger;

    const enableMemory = this.config.enableMemory;

    this.ctx["yesimbot.extension"].registerExtension({
      id: "workspace",
      setup(api: ExtensionAPI, context?: ChannelContext) {
        api.on("agent:before-start", (event) => {
          const sandboxInstruction = `## Bash Sandbox Environment
You are operating in a sandboxed bash environment with the following configuration:
- Current working directory: ${workspaceConfig.bash.cwd}
- Network access: ${workspaceConfig.bash.network ? "Enabled" : "Disabled"}
- Command execution timeout: ${workspaceConfig.bash.timeoutMs} ms
- Use \`help\` command to see available commands and tools.

Use this environment to execute commands safely. Always be mindful of the limitations and configurations when running commands.
`;

          let memoryInstruction = "";
          if (enableMemory) {
            const channelKey = context
              ? encodeChannelId(context.platform, context.channelId)
              : null;

            memoryInstruction = `
=== 记忆能力 ===

你拥有持久化的文件系统和会话日志，它们是你的长期记忆载体。

<文件记忆>
workspace 中的文件可用于存储长期记忆。你可以：
- 读取已有文件回顾之前记录的信息
- 创建或编辑文件来持久化重要事实、偏好、任务状态
- 使用 grep/glob 工具检索记忆文件

建议将记忆文件组织为：
- 事实性信息（用户身份、关系、关键数据）
- 偏好与习惯（沟通风格、常用工具、领域偏好）
- 进行中的任务（待办、进度、上下文）
- 暂时性上下文（当前话题、临时备注）
</文件记忆>

<会话日志>
`;

            if (sessionIsolation) {
              memoryInstruction += `
历史会话以 JSONL 格式存储在 /data/sessions/ 目录下，每个频道一个子目录。
${channelKey ? `当前频道标识: ${channelKey}（你的会话在 /data/sessions/${channelKey}/ 目录）` : ""}
`;
            } else {
              memoryInstruction += `
历史会话以 JSONL 格式存储在 /data/sessions/ 目录。
每个子目录以 channelKey 命名，包含该频道的会话日志。
${channelKey ? `当前频道标识: ${channelKey}` : ""}

映射表 /data/sessions/channel-map.json 包含 channelKey 到 platform:channelId 的映射。
`;
            }

            memoryInstruction += `<JSONL 格式>
会话日志每行一个 JSON 对象，主要类型：

1. session 头：{"type":"session","id":"...","timestamp":"..."}
2. 用户消息：{"type":"custom_message","customType":"athena:message","content":"...","details":{...}}
3. 助手回复：{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"..."}]}}
4. 工具调用：{"type":"message","message":{"role":"assistant","content":[{"type":"tool-call",...}]}}
5. 工具结果：{"type":"message","message":{"role":"tool","content":[{"type":"tool-result",...}]}}
</JSONL 格式>

<重要：会话日志噪声过滤>
会话日志包含大量工具调用和结果，完整读取非常浪费 token。必须遵循以下规则：

1. **永远不要** cat/read_file 完整 JSONL 文件
2. **始终用 grep 或 jq 过滤**后再读取
3. 优先只看用户消息和助手文本回复，跳过工具调用/结果：
   - 用户消息: grep "athena:message" 或 jq 'select(.customType=="athena:message")'
   - 助手文本: jq 'select(.message.role=="assistant") | .message.content[]? | select(.type=="text") | .text'
4. 如需查看特定话题，用 grep 关键词定位行号，再用 offset+limit 读取上下文
5. 如需时间范围，用 head/tail 截取，不要读全文件

常用过滤命令：
\`\`\`bash
# 只看用户消息（内容字段）
jq -r 'select(.customType=="athena:message") | .content' session.jsonl

# 只看助手文本回复
jq -r 'select(.message?.role=="assistant") | .message.content[]? | select(.type=="text") | .text' session.jsonl

# 按关键词定位行号
grep -n "关键词" session.jsonl

# 读取指定行范围（如第 50-80 行）
sed -n '50,80p' session.jsonl

# 统计各类消息数量
jq -r 'if .customType then "user" elif .message?.role=="assistant" then "assistant" else "other" end' session.jsonl | sort | uniq -c
\`\`\`
</重要：会话日志噪声过滤>

<检索方式>
关于当前会话：
- 你当前会话的近期消息已在上下文中，不需要从文件读取
- 如果会话很长且内部压缩启动过，早期消息可能已被截断。此时需要读取 JSONL 文件补全上下文
- 当前会话文件可通过 meta.json 的 current_session 字段找到

检索历史记录时：${
              sessionIsolation && channelKey
                ? `
0. 当前频道目录 /data/sessions/${channelKey}/`
                : ""
            }
1. ${sessionIsolation ? "在当前频道目录中查找" : "查阅 channel-map.json 确认目标频道的 channelKey"}
2. 用 grep -n 定位关键词行号，再用 offset+limit 或 sed 读取上下文
3. 需要用户消息时用 jq 'select(.customType=="athena:message")' 过滤
4. 需要助手回复时用 jq 'select(.message?.role=="assistant")' 过滤
5. 不要猜测内容，不要读取完整文件
</检索方式>
</会话日志>
`;
          }

          return {
            systemPrompt: event.systemPrompt + `\n\n${sandboxInstruction}${memoryInstruction}`,
          };
        });

        logger.info("Registering workspace tools...");

        const tools = createWorkspaceTools(workspace);
        for (const tool of tools) {
          api.registerTool(tool as ToolDefinition);
          logger.info(`Registered tool: ${tool.name}`);
        }

        return {
          dispose() {
            logger.info("Workspace extension disposed");
          },
        };
      },
    } as AthenaExtensionDefinition);

    this.logger.success("Workspace plugin started");
  }

  async stop(): Promise<void> {
    this.ctx["yesimbot.extension"].unregisterExtension("workspace");
    this.logger.info("Workspace plugin stopped");
  }
}
