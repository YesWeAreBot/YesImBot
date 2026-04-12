import { Metadata, YesImPlugin } from "@yesimbot/plugin-sdk";
import type { RegisteredToolDefinition } from "@yesimbot/plugin-sdk";
import type { Context, Logger } from "koishi";

import type { ChannelRuntimeOptions } from "../runtime";
import { buildWorkspacePluginToolDefinitions } from "../runtime/workspace-tools";
import type { AthenaSessionSettings } from "../settings-manager";
import { LocalFilesystem } from "./filesystem";
import { LocalSandbox } from "./sandbox";

interface WorkspacePluginOptions {
  basePath: string;
  settingsManager: ChannelRuntimeOptions["settingsManager"];
  logger: Logger;
  createFilesystem?: (
    workspaceRoot: string,
    workspaceSettings: AthenaSessionSettings["workspace"],
  ) => LocalFilesystem | undefined;
  createSandbox?: (
    workspaceRoot: string,
    workspaceSettings: AthenaSessionSettings["workspace"],
  ) => LocalSandbox | undefined;
}

@Metadata({
  name: "workspace",
  description: "Scoped workspace tool provider",
  managedLifecycle: true,
})
export class WorkspacePlugin extends YesImPlugin {
  private readonly options: WorkspacePluginOptions;
  private initialized = false;

  constructor(ctx: Context, options: WorkspacePluginOptions) {
    super(ctx);
    this.options = options;
  }

  override getToolDefinitions(): RegisteredToolDefinition[] {
    if (!this.initialized) {
      throw new Error("WorkspacePlugin tool definitions accessed before init()");
    }

    return super.getToolDefinitions();
  }

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const definitions = await buildWorkspacePluginToolDefinitions({
      basePath: this.options.basePath,
      settingsManager: this.options.settingsManager,
      logger: this.options.logger,
      createFilesystem: this.options.createFilesystem,
      createSandbox: this.options.createSandbox,
    });

    for (const definition of definitions) {
      this.registerWorkspaceToolDefinition(definition);
    }

    this.initialized = true;
  }

  protected registerWorkspaceToolDefinition(definition: RegisteredToolDefinition): void {
    this.registerToolDefinition(definition);
  }
}
