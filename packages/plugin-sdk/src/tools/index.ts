import type { JSONSchema4 } from "json-schema";
import type { Context, Schema } from "koishi";

export enum FunctionType {
  Tool = "tool",
  Action = "action",
}

export interface ToolSuccess<T = unknown> {
  ok: true;
  data: T;
  metadata?: Record<string, unknown>;
}

export interface ToolFailure {
  ok: false;
  error: string;
  metadata?: Record<string, unknown>;
}

export type ToolResult<T = unknown> = ToolSuccess<T> | ToolFailure;

export interface ToolExecutionContext {
  platform: string;
  channelId: string;
  session?: unknown;
  bot?: unknown;
  percept?: unknown;
  roundContext?: unknown;
  scenario?: unknown;
  capabilities?: unknown;
}

export interface FunctionDefinition {
  name: string;
  description: string;
  type: FunctionType;
  parameters: Schema;
  handler: (params: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<ToolResult>;
  requiredCapabilities?: string[];
  onCapabilityMissing?: "remove" | "hint";
  hidden?: boolean;
}

export interface PluginMetadata {
  name: string;
  description: string;
  builtin?: boolean;
  skillPacks?: string[];
}

interface DecoratorOpts {
  name: string;
  description: string;
  parameters: Schema;
  requiredCapabilities?: string[];
  onCapabilityMissing?: "remove" | "hint";
  hidden?: boolean;
}

interface StaticEntry extends DecoratorOpts {
  type: FunctionType;
  methodKey: string;
}

interface RuntimePluginService {
  mountPlugin(plugin: YesImPlugin): Promise<void>;
  unmountPlugin(name: string): void;
}

type PluginRuntimeContext = Context & {
  "yesimbot.plugin"?: RuntimePluginService;
};

export function Metadata(meta: PluginMetadata): ClassDecorator {
  return (target) => {
    (target as unknown as { prototype: Record<string, unknown> }).prototype.__pluginMetadata = meta;
  };
}

export function Tool(opts: DecoratorOpts): MethodDecorator {
  return (target, propertyKey) => {
    const proto = target as Record<string, unknown>;
    if (!proto.__staticTools) proto.__staticTools = [];
    (proto.__staticTools as StaticEntry[]).push({
      ...opts,
      type: FunctionType.Tool,
      methodKey: String(propertyKey),
    });
  };
}

export function Action(opts: DecoratorOpts): MethodDecorator {
  return (target, propertyKey) => {
    const proto = target as Record<string, unknown>;
    if (!proto.__staticActions) proto.__staticActions = [];
    (proto.__staticActions as StaticEntry[]).push({
      ...opts,
      type: FunctionType.Action,
      methodKey: String(propertyKey),
    });
  };
}

export function defineTool(
  name: string,
  description: string,
  parameters: Schema,
  handler: (params: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<ToolResult>,
): FunctionDefinition {
  return { name, description, type: FunctionType.Tool, parameters, handler };
}

export function defineAction(
  name: string,
  description: string,
  parameters: Schema,
  handler: (params: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<ToolResult>,
): FunctionDefinition {
  return { name, description, type: FunctionType.Action, parameters, handler };
}

export function withInnerThoughts(params: Record<string, Schema>): Schema {
  return {
    type: "object",
    dict: {
      inner_thoughts: {
        type: "string",
        meta: {
          description: "Deep inner monologue private to you only.",
        },
      },
      ...params,
    },
  } as unknown as Schema;
}

export class YesImPlugin {
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
      const pluginService = (ctx as PluginRuntimeContext)["yesimbot.plugin"];
      if (!pluginService) return;
      await pluginService.mountPlugin(this);
    });

    ctx.on("dispose", async () => {
      const pluginService = (ctx as PluginRuntimeContext)["yesimbot.plugin"];
      pluginService?.unmountPlugin(this.metadata.name);
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

export function Success<T>(result?: T): ToolSuccess<T | undefined> {
  return { ok: true, data: result };
}

export function Failed(error: string, metadata?: Record<string, unknown>): ToolFailure {
  return { ok: false, error, metadata };
}

export function schemaToJSONSchema(schema: Schema): JSONSchema4 {
  if (!schema) return {};
  const type = schema.type as string;

  const meta: JSONSchema4 = {};
  if (schema.meta?.description && typeof schema.meta.description === "string") {
    meta.description = schema.meta.description;
  }
  if (schema.meta?.default !== undefined) {
    meta.default = schema.meta.default;
  }

  switch (type) {
    case "object": {
      const properties: Record<string, JSONSchema4> = {};
      const required: string[] = [];
      const dict = schema.dict as Record<string, Schema> | undefined;

      for (const [key, child] of Object.entries(dict ?? {})) {
        properties[key] = schemaToJSONSchema(child);
        if (child.meta?.required) required.push(key);
      }

      return {
        type: "object",
        properties,
        required: required.length > 0 ? required : undefined,
        ...meta,
      };
    }
    case "array":
      return {
        type: "array",
        items: schema.inner ? schemaToJSONSchema(schema.inner as Schema) : {},
        ...meta,
      };
    case "dict":
      return {
        type: "object",
        additionalProperties: schema.inner ? schemaToJSONSchema(schema.inner as Schema) : true,
        ...meta,
      };
    case "const":
      return { const: schema.value, ...meta };
    case "union": {
      const list = schema.list ?? [];
      const values = list.map((s) => (s as Schema).value);
      const allConst = values.every((v) => v !== undefined);
      return allConst ? { enum: values, ...meta } : { oneOf: list.map((s) => schemaToJSONSchema(s as Schema)), ...meta };
    }
    case "intersect":
      return { allOf: (schema.list ?? []).map((s) => schemaToJSONSchema(s as Schema)), ...meta };
    case "string": {
      const result: JSONSchema4 = { type: "string", ...meta };
      if (schema.meta?.pattern) {
        result.pattern = schema.meta.pattern.source;
      }
      return result;
    }
    case "number":
    case "natural":
    case "percent": {
      const result: JSONSchema4 = { type: "number", ...meta };
      if (schema.meta?.min !== undefined) result.minimum = schema.meta.min;
      if (schema.meta?.max !== undefined) result.maximum = schema.meta.max;
      if (schema.meta?.step !== undefined) result.multipleOf = schema.meta.step;
      return result;
    }
    case "boolean":
      return { type: "boolean", ...meta };
    case "date":
      return { type: "string", format: "date-time", ...meta };
    default:
      return meta;
  }
}

export function jsonSchemaToSchema(jsonSchema: JSONSchema4): Schema {
  if ("const" in jsonSchema && jsonSchema.const !== undefined) {
    return {
      type: "const",
      value: jsonSchema.const,
    } as unknown as Schema;
  }

  if (jsonSchema.enum) {
    return {
      type: "union",
      list: jsonSchema.enum.map((value) => ({ type: "const", value })),
    } as unknown as Schema;
  }

  if (jsonSchema.oneOf) {
    return {
      type: "union",
      list: jsonSchema.oneOf.map((schema) => jsonSchemaToSchema(schema)),
    } as unknown as Schema;
  }

  if (jsonSchema.allOf) {
    return {
      type: "intersect",
      list: jsonSchema.allOf.map((schema) => jsonSchemaToSchema(schema)),
    } as unknown as Schema;
  }

  if (jsonSchema.anyOf) {
    return {
      type: "union",
      list: jsonSchema.anyOf.map((schema) => jsonSchemaToSchema(schema)),
    } as unknown as Schema;
  }

  const type = Array.isArray(jsonSchema.type) ? jsonSchema.type[0] : jsonSchema.type;

  if (type === "object") {
    const properties = jsonSchema.properties ?? {};
    const required = new Set(Array.isArray(jsonSchema.required) ? jsonSchema.required : []);
    const dict: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(properties)) {
      dict[key] = {
        ...(jsonSchemaToSchema(value) as unknown as Record<string, unknown>),
        meta: {
          required: required.has(key),
        },
      };
    }

    return {
      type: "object",
      dict,
      meta: {
        description: jsonSchema.description,
        default: jsonSchema.default,
      },
    } as unknown as Schema;
  }

  if (type === "array") {
    return {
      type: "array",
      inner: jsonSchema.items ? jsonSchemaToSchema(jsonSchema.items) : ({ type: "any" } as unknown),
      meta: {
        description: jsonSchema.description,
        default: jsonSchema.default,
      },
    } as unknown as Schema;
  }

  return {
    type: (type as string) || "any",
    meta: {
      description: jsonSchema.description,
      default: jsonSchema.default,
    },
  } as unknown as Schema;
}
