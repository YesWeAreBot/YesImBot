import { Metadata, YesImPlugin } from "@yesimbot/plugin-sdk";
import type { Logger } from "koishi";
import { Context, Schema } from "koishi";

import { buildWorkspacePluginToolDefinitions } from "./tool-definitions";
import type { WorkspacePluginConfig, WorkspacePluginOptions } from "./types";

@Metadata({
  name: "workspace",
  description: "Workspace tool provider",
})
export default class WorkspacePlugin extends YesImPlugin {
  private readonly channelDir: string;
  private readonly logger: Logger;
  private readonly config: WorkspacePluginConfig;
  private readonly options?: WorkspacePluginOptions;
  private initialized = false;

  static name = "workspace";
  static inject = ["yesimbot.plugin"];
  static Config: Schema<WorkspacePluginConfig> = Schema.object({
    mode: Schema.union([Schema.const("scoped"), Schema.const("global")]).default("scoped"),
    enableWorkspace: Schema.boolean().default(true),
    enableSandbox: Schema.boolean().default(false),
    enableFilesystem: Schema.boolean().default(true),
    externalPath: Schema.array(Schema.path({ allowCreate: true }))
      .role("table")
      .default([]),
  });

  constructor(ctx: Context, config: WorkspacePluginConfig | WorkspacePluginOptions) {
    super(ctx);

    if (isWorkspacePluginOptions(config)) {
      this.channelDir = config.basePath;
      this.logger = config.logger;
      this.options = config;
      this.config = {
        ...config.config,
      };
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
}

function isWorkspacePluginOptions(
  value: WorkspacePluginConfig | WorkspacePluginOptions,
): value is WorkspacePluginOptions {
  return "basePath" in value;
}
