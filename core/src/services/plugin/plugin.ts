import { Context } from "koishi";

import type { HookService } from "../hook/service";
import { StaticEntry } from "./decorators";
import type { FunctionDefinition, IPluginService, PluginMetadata } from "./types";

declare module "koishi" {
  interface Context {
    "yesimbot.plugin": IPluginService;
  }
}

export abstract class YesImPlugin {
  public readonly ctx: Context;
  metadata: PluginMetadata;
  tools: Map<string, FunctionDefinition> = new Map();
  actions: Map<string, FunctionDefinition> = new Map();
  private hooksRegistered = false;
  private skillPackDisposers: Array<() => void> = [];
  private skillPacksMounted = false;

  constructor(ctx: Context) {
    this.ctx = ctx;
    const proto = Object.getPrototypeOf(this) as Record<string, unknown>;
    this.metadata = (proto.__pluginMetadata as PluginMetadata) ?? {
      name: "unknown",
      description: "",
    };

    for (const entry of (proto.__staticTools as StaticEntry[] | undefined) ?? []) {
      const handler = (this as unknown as Record<string, unknown>)[
        entry.methodKey
      ] as FunctionDefinition["handler"];
      this.tools.set(entry.name, {
        name: entry.name,
        description: entry.description,
        type: entry.type,
        parameters: entry.parameters,
        handler: handler.bind(this),
        requiredCapabilities: entry.requiredCapabilities,
        onCapabilityMissing: entry.onCapabilityMissing,
        hidden: entry.hidden,
      });
    }

    for (const entry of (proto.__staticActions as StaticEntry[] | undefined) ?? []) {
      const handler = (this as unknown as Record<string, unknown>)[
        entry.methodKey
      ] as FunctionDefinition["handler"];
      this.actions.set(entry.name, {
        name: entry.name,
        description: entry.description,
        type: entry.type,
        parameters: entry.parameters,
        handler: handler.bind(this),
        requiredCapabilities: entry.requiredCapabilities,
        onCapabilityMissing: entry.onCapabilityMissing,
        hidden: entry.hidden,
      });
    }

    ctx.on("ready", async () => {
      const hookService = ctx["yesimbot.hook"] as HookService | undefined;
      if (hookService && !this.hooksRegistered) {
        hookService.registerFromDecorators(ctx, this);
        this.hooksRegistered = true;
      }

      const skillRegistry = ctx["yesimbot.skill"] as
        | { registerDir?: (dir: string, source: "plugin" | "file") => Array<() => void> }
        | undefined;
      if (skillRegistry?.registerDir && !this.skillPacksMounted) {
        for (const dir of this.metadata.skillPacks ?? []) {
          const disposers = skillRegistry.registerDir(dir, "plugin");
          this.skillPackDisposers.push(...disposers);
        }
        this.skillPacksMounted = true;
      }

      ctx["yesimbot.plugin"].registerPlugin(this);
    });

    ctx.on("dispose", async () => {
      this.hooksRegistered = false;
      for (const dispose of this.skillPackDisposers) {
        dispose();
      }
      this.skillPackDisposers = [];
      this.skillPacksMounted = false;
      ctx["yesimbot.plugin"].unregisterPlugin(this.metadata.name);
    });
  }

  getFunctions(): Map<string, FunctionDefinition> {
    return new Map([...this.tools, ...this.actions]);
  }

  registerTool(def: FunctionDefinition): void {
    this.tools.set(def.name, def);
  }

  registerAction(def: FunctionDefinition): void {
    this.actions.set(def.name, def);
  }
}
