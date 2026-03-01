import { Context } from "koishi";

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
        activators: entry.activators,
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
        activators: entry.activators,
        hidden: entry.hidden,
      });
    }

    ctx.on("ready", async () => {
      ctx["yesimbot.plugin"].registerPlugin(this);
    });

    ctx.on("dispose", async () => {
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
