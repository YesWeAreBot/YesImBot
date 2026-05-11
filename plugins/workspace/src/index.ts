import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import type { ExtensionAPI, ToolDefinition } from "@yesimbot/agent/session";
import { Context, Logger, Schema, Service } from "koishi";
import type {} from "koishi-plugin-yesimbot";

import { createWorkspaceTools } from "./tools";
import type { WorkspaceConfig } from "./types";
import { Workspace } from "./workspace";

export interface WorkspacePluginConfig {
  root: string;
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
    persistPaths: Schema.dict(
      Schema.path({ filters: ["directory", "file"], allowCreate: true }),
    ).description("持久化路径映射"),
    timeoutMs: Schema.number().default(30000).description("命令执行超时（毫秒）"),
    enableNetwork: Schema.boolean().default(false).description("启用网络访问"),
    enablePython: Schema.boolean().default(false).description("启用 Python 执行"),
    enableJavascript: Schema.boolean().default(false).description("启用 JavaScript 执行"),
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
        timeoutMs: this.config.timeoutMs,
        network: this.config.enableNetwork ? {} : undefined,
        python: this.config.enablePython,
        javascript: this.config.enableJavascript,
      },
    };

    this.ws = new Workspace(workspaceConfig);
    await this.ws.init();

    const workspace = this.ws;
    const logger = this.logger;

    this.ctx["yesimbot.extension"].registerExtension({
      id: "workspace",
      setup(api: ExtensionAPI) {
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
    });

    this.logger.success("Workspace plugin started");
  }

  async stop(): Promise<void> {
    this.logger.info("Workspace plugin stopped");
  }
}
