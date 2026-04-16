import { Metadata, YesImPlugin } from "@yesimbot/plugin-sdk";
import type { BuildContextRequest } from "@yesimbot/plugin-sdk";
import type { Logger } from "koishi";
import { Context, Schema } from "koishi";

import { buildWorkspacePluginToolDefinitions, getWorkspaceRoot } from "./tool-definitions";
import type { WorkspacePluginConfig, WorkspacePluginOptions } from "./types";

@Metadata({
  name: "workspace",
  description: "Workspace tool provider",
})
export default class WorkspacePlugin extends YesImPlugin<WorkspacePluginConfig> {
  private readonly channelDir: string;
  private readonly logger: Logger;
  private readonly options?: WorkspacePluginOptions;
  private initialized = false;

  static name = "workspace";
  static inject = ["yesimbot.plugin"];
  static Config: Schema<WorkspacePluginConfig> = Schema.object({
    mode: Schema.union([Schema.const("scoped"), Schema.const("global")]).default("scoped"),
    globalWorkspacePath: Schema.path({ filters: ["directory"], allowCreate: true }).default(
      "data/yesimbot/workspace",
    ),
    enableWorkspace: Schema.boolean().default(true),
    enableSandbox: Schema.boolean().default(false),
    enableFilesystem: Schema.boolean().default(true),
    externalPath: Schema.array(Schema.path({ filters: ["directory"], allowCreate: true }))
      .role("table")
      .default([]),
  });

  constructor(ctx: Context, config: WorkspacePluginConfig | WorkspacePluginOptions) {
    super(ctx);

    if (isWorkspacePluginOptions(config)) {
      this.channelDir = config.basePath;
      this.logger = config.logger;
      this.options = config;
      this.config = { ...config.config };
      return;
    }

    this.channelDir = ctx.baseDir;
    this.logger = ctx.logger("workspace");
    this.config = config;
  }

  override getToolDefinitions() {
    if (!this.initialized) {
      throw new Error("WorkspacePlugin tool definitions accessed before init()");
    }

    return super.getToolDefinitions();
  }

  override async start(): Promise<void> {
    await super.start();
    await this.init();
  }

  override async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const definitions = await buildWorkspacePluginToolDefinitions({
      channelDir: this.channelDir,
      logger: this.logger,
      config: this.config,
      createFilesystem: this.options?.createFilesystem,
      createSandbox: this.options?.createSandbox,
    });

    for (const definition of definitions) {
      this.registerToolDefinition(definition);
    }

    this.initialized = true;
  }

  override buildContext<THostInput>(
    request: BuildContextRequest<THostInput>,
  ): Record<string, unknown> {
    return {
      workspaceRoot: getWorkspaceRoot({
        channelDir: this.channelDir,
        runtimeBasePath: request.runtime.basePath,
        config: this.config,
      }),
    };
  }
}

function isWorkspacePluginOptions(
  value: WorkspacePluginConfig | WorkspacePluginOptions,
): value is WorkspacePluginOptions {
  return "basePath" in value;
}
