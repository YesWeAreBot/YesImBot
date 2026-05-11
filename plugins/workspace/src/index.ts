import type { ExtensionAPI } from "@yesimbot/agent/session";
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
    persistPaths: Schema.dict(Schema.string()).description("持久化路径映射"),
    timeoutMs: Schema.number().default(30000).description("命令执行超时（毫秒）"),
    enableNetwork: Schema.boolean().default(false).description("启用网络访问"),
    enablePython: Schema.boolean().default(false).description("启用 Python 执行"),
    enableJavascript: Schema.boolean().default(false).description("启用 JavaScript 执行"),
  });

  private ws?: Workspace;
  private log: Logger;

  constructor(ctx: Context, config: WorkspacePluginConfig) {
    super(ctx, "yesimbot.workspace");
    this.log = ctx.logger("workspace");
    this.config = config;
  }

  async start(): Promise<void> {
    this.log.info("Starting workspace plugin...");

    const workspaceConfig: WorkspaceConfig = {
      root: this.config.root,
      filesystem: {
        persistPaths: this.config.persistPaths,
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
    const log = this.log;

    this.ctx["yesimbot.extension"].registerExtension({
      id: "workspace",
      setup(api: ExtensionAPI) {
        log.info("Registering workspace tools...");

        const tools = createWorkspaceTools(workspace);
        for (const tool of tools) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          api.registerTool(tool as any);
          log.info(`Registered tool: ${tool.name}`);
        }

        return {
          dispose() {
            log.info("Workspace extension disposed");
          },
        };
      },
    });

    this.log.success("Workspace plugin started");
  }

  async stop(): Promise<void> {
    this.log.info("Workspace plugin stopped");
  }
}
