import type { FunctionDefinition, PluginMetadata } from "./types";

interface StaticEntry {
  name: string;
  description: string;
  parameters: import("koishi").Schema;
  type: import("./types").FunctionType;
  methodKey: string;
}

export abstract class Plugin {
  metadata: PluginMetadata;
  tools: Map<string, FunctionDefinition> = new Map();
  actions: Map<string, FunctionDefinition> = new Map();

  constructor() {
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
      });
    }
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
