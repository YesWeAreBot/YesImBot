import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { Context, Logger, Schema, Service } from "koishi";
import type { ExtensionAPI, ExtensionDefinition, ToolDefinition } from "koishi-plugin-yesimbot";

import { createWorkspaceTools } from "./tools";
import type { WorkspaceConfig } from "./types";
import { Workspace } from "./workspace";

export interface WorkspacePluginConfig {
  root: string;
  cwd: string;
  persistPaths?: Record<string, string>;
  timeoutMs?: number;
  enableNetwork?: boolean;
  enablePython?: boolean;
  enableJavascript?: boolean;
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

    this.logger.info(`Workspace root: ${root}`);
    this.logger.info(`Persist paths: ${JSON.stringify(persistPaths, null, 2)}`);

    const workspaceConfig: WorkspaceConfig = {
      root,
      filesystem: {
        persistPaths,
      },
      bash: {
        cwd: this.config.cwd,
        timeoutMs: this.config.timeoutMs,
        network: this.config.enableNetwork ? {} : undefined,
        // python: this.config.enablePython,
        // javascript: this.config.enableJavascript,
      },
    };

    this.ws = new Workspace(workspaceConfig);
    await this.ws.init();

    const workspace = this.ws;
    const logger = this.logger;

    this.ctx["yesimbot.extension"].registerExtension({
      id: "workspace",
      setup(api: ExtensionAPI) {
        api.on("agent:before-start", ((event: { systemPrompt: string }) => {
          const sandboxInstruction = `## Bash Sandbox Environment
You are operating in a sandboxed bash environment with the following configuration:
- Current working directory: ${workspaceConfig.bash.cwd}
- Network access: ${workspaceConfig.bash.network ? "Enabled" : "Disabled"}
- Command execution timeout: ${workspaceConfig.bash.timeoutMs} ms
- Use \`help\` command to see available commands and tools.

Use this environment to execute commands safely. Always be mindful of the limitations and configurations when running commands.
`;

          return {
            systemPrompt: event.systemPrompt + `\n\n${sandboxInstruction}`,
          };
        }) as (...args: unknown[]) => unknown);

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
    } satisfies ExtensionDefinition);

    this.logger.success("Workspace plugin started");
  }

  async stop(): Promise<void> {
    this.ctx["yesimbot.extension"].unregisterExtension("workspace");
    this.logger.info("Workspace plugin stopped");
  }
}
