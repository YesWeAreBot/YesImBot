import type { Tool as AiTool } from "@ai-sdk/provider-utils";
import type {
  RegisteredToolDefinition,
  ToolExtensionContext,
  ToolRuntime,
} from "@yesimbot/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import {
  buildToolAssembly,
  type ToolAssemblyContextFactory,
  type ToolAssemblySourceContributor,
} from "../../src/services/session/runtime/tool-assembly";

function createToolRuntime(overrides: Partial<ToolRuntime> = {}): ToolRuntime {
  return {
    channelKey: "discord:channel-1",
    platform: "discord",
    channelId: "channel-1",
    modelId: "openai:gpt-4o-mini",
    basePath: "/tmp/athena-tool-assembly",
    turn: {
      messageId: "msg-1",
      timestamp: 1_710_000_000_000,
      isDirect: false,
      atSelf: true,
      isReplyToBot: false,
    },
    ...overrides,
  };
}

function createAiTool(label: string): AiTool {
  return {
    description: `${label} tool`,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    execute: vi.fn(async () => label),
  } as unknown as AiTool;
}

function createPluginToolDefinition(options: {
  pluginName: string;
  name: string;
  builtin?: boolean;
  isSupported?: RegisteredToolDefinition["definition"]["isSupported"];
  isAllowed?: RegisteredToolDefinition["definition"]["isAllowed"];
  buildExtensionContext?: RegisteredToolDefinition["definition"]["buildExtensionContext"];
}): RegisteredToolDefinition {
  return {
    pluginName: options.pluginName,
    name: options.name,
    definition: {
      name: options.name,
      description: `${options.pluginName}:${options.name}`,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
      builtin: options.builtin,
      isSupported: options.isSupported,
      isAllowed: options.isAllowed,
      buildExtensionContext: options.buildExtensionContext,
      execute: async () => options.name,
    },
    tool: createAiTool(options.name),
  };
}

function createSourceContributor(name: string): ToolAssemblySourceContributor {
  return {
    pluginName: "source-fixture",
    name,
    definition: {
      name,
      description: `source:${name}`,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
      isSupported: () => true,
      isAllowed: ({ enabledTools }) => enabledTools.includes(name),
      execute: async () => name,
    },
    tool: createAiTool(name),
  };
}

describe("buildToolAssembly", () => {
  it("returns stable supportedTools while activeTools only honors tools.enabled + isAllowed for non-builtin capabilities", () => {
    const runtime = createToolRuntime();
    const search = createPluginToolDefinition({
      pluginName: "search-service",
      name: "search_docs",
      isSupported: () => true,
      isAllowed: ({ enabledTools, extensionContext }) =>
        enabledTools.includes("search_docs") &&
        (extensionContext["search-service"] as { allow: boolean } | undefined)?.allow === true,
    });

    const withoutToolsEnabled = buildToolAssembly({
      runtime,
      hostInput: { allowSearch: true },
      pluginToolDefinitions: [search],
      sourceToolDefinitions: [],
      toolSettings: {},
      contextFactories: {
        "search-service": ((hostInput: { allowSearch: boolean }) => ({
          allow: hostInput.allowSearch,
        })) satisfies ToolAssemblyContextFactory,
      },
    });

    expect(Object.keys(withoutToolsEnabled.supportedTools)).toEqual([
      "send_message",
      "search_docs",
    ]);
    expect(Object.keys(withoutToolsEnabled.activeTools)).toEqual(["send_message"]);

    const withToolsEnabled = buildToolAssembly({
      runtime,
      hostInput: { allowSearch: true },
      pluginToolDefinitions: [search],
      sourceToolDefinitions: [],
      toolSettings: {
        enabled: ["search_docs"],
      },
      contextFactories: {
        "search-service": ((hostInput: { allowSearch: boolean }) => ({
          allow: hostInput.allowSearch,
        })) satisfies ToolAssemblyContextFactory,
      },
    });

    expect(Object.keys(withToolsEnabled.supportedTools)).toEqual(["send_message", "search_docs"]);
    expect(Object.keys(withToolsEnabled.activeTools)).toEqual(["send_message", "search_docs"]);
    expect(withToolsEnabled.experimentalContext).toEqual({
      "search-service": {
        allow: true,
      },
    });
    expect(withToolsEnabled.signature).toContain("send_message");
    expect(withToolsEnabled.signature).toContain("search_docs");
  });

  it("routes workspace tools like read_file through the same contributor contract instead of runtime special-cases", () => {
    const runtime = createToolRuntime();
    const contributors = [
      "read_file",
      "list_files",
      "file_stat",
      "grep",
      "write_file",
      "edit_file",
      "delete",
      "mkdir",
      "execute_command",
    ].map(createSourceContributor);

    const assembly = buildToolAssembly({
      runtime,
      hostInput: {},
      pluginToolDefinitions: [],
      sourceToolDefinitions: contributors,
      toolSettings: {
        enabled: ["read_file", "execute_command"],
      },
    });

    expect(Object.keys(assembly.supportedTools)).toEqual([
      "send_message",
      "read_file",
      "list_files",
      "file_stat",
      "grep",
      "write_file",
      "edit_file",
      "delete",
      "mkdir",
      "execute_command",
    ]);
    expect(Object.keys(assembly.activeTools)).toEqual([
      "send_message",
      "read_file",
      "execute_command",
    ]);
  });

  it("treats tools.required, reserved names, and duplicate explicit names as fail-fast seams while omitting optional capabilities", () => {
    const runtime = createToolRuntime();
    const optionalMissing = createPluginToolDefinition({
      pluginName: "search-service",
      name: "optional_search",
      isSupported: () => false,
    });

    const optionalAssembly = buildToolAssembly({
      runtime,
      hostInput: {},
      pluginToolDefinitions: [optionalMissing],
      sourceToolDefinitions: [],
      toolSettings: {
        enabled: ["optional_search"],
      },
    });

    expect(Object.keys(optionalAssembly.supportedTools)).toEqual(["send_message"]);
    expect(Object.keys(optionalAssembly.activeTools)).toEqual(["send_message"]);

    expect(() =>
      buildToolAssembly({
        runtime,
        hostInput: {},
        pluginToolDefinitions: [optionalMissing],
        sourceToolDefinitions: [],
        toolSettings: {
          required: ["optional_search"],
        },
      }),
    ).toThrow(/tools.required|optional_search/i);

    expect(() =>
      buildToolAssembly({
        runtime,
        hostInput: {},
        pluginToolDefinitions: [
          createPluginToolDefinition({
            pluginName: "bad-plugin",
            name: "send_message",
            isSupported: () => true,
          }),
        ],
        sourceToolDefinitions: [],
        toolSettings: {},
      }),
    ).toThrow(/send_message/i);

    expect(() =>
      buildToolAssembly({
        runtime,
        hostInput: {},
        pluginToolDefinitions: [
          createPluginToolDefinition({
            pluginName: "search-a",
            name: "search_docs",
            isSupported: () => true,
          }),
        ],
        sourceToolDefinitions: [createSourceContributor("search_docs")],
        toolSettings: {},
      }),
    ).toThrow(/duplicate|search_docs/i);
  });

  it("rebuilds ToolExtensionContext from the current turn host input before recalculating activeTools", () => {
    const runtime = createToolRuntime();
    const seenContexts: ToolExtensionContext[] = [];
    const search = createPluginToolDefinition({
      pluginName: "search-service",
      name: "search_docs",
      isSupported: () => true,
      isAllowed: ({ extensionContext, enabledTools }) => {
        seenContexts.push(extensionContext);
        return (
          enabledTools.includes("search_docs") &&
          (extensionContext["search-service"] as { allow: boolean } | undefined)?.allow === true
        );
      },
    });

    const toolSettings = {
      enabled: ["search_docs"],
    };
    const contextFactories = {
      "search-service": ((hostInput: { allowSearch: boolean }) => ({
        allow: hostInput.allowSearch,
      })) satisfies ToolAssemblyContextFactory,
    };

    const first = buildToolAssembly({
      runtime,
      hostInput: { allowSearch: false },
      pluginToolDefinitions: [search],
      sourceToolDefinitions: [],
      toolSettings,
      contextFactories,
    });

    const second = buildToolAssembly({
      runtime,
      hostInput: { allowSearch: true },
      pluginToolDefinitions: [search],
      sourceToolDefinitions: [],
      toolSettings,
      contextFactories,
    });

    expect(Object.keys(first.supportedTools)).toEqual(["send_message", "search_docs"]);
    expect(Object.keys(first.activeTools)).toEqual(["send_message"]);
    expect(Object.keys(second.supportedTools)).toEqual(["send_message", "search_docs"]);
    expect(Object.keys(second.activeTools)).toEqual(["send_message", "search_docs"]);
    expect(seenContexts).toEqual([
      {
        "search-service": {
          allow: false,
        },
      },
      {
        "search-service": {
          allow: true,
        },
      },
    ]);
  });

  it("does not build plugin context for unsupported definitions", () => {
    const runtime = createToolRuntime({ platform: "discord" });
    const buildExtensionContext = vi.fn(() => {
      throw new Error("should not build unsupported context");
    });
    const unsupported = createPluginToolDefinition({
      pluginName: "platform-specific",
      name: "manage_group",
      isSupported: ({ runtime: currentRuntime }) => currentRuntime.platform === "wechat",
      buildExtensionContext,
      isAllowed: () => true,
    });

    const assembly = buildToolAssembly({
      runtime,
      hostInput: { authorRoles: ["admin"] },
      pluginToolDefinitions: [unsupported],
      sourceToolDefinitions: [],
      toolSettings: {
        enabled: ["manage_group"],
      },
      contextFactories: {
        "platform-specific": buildExtensionContext,
      },
    });

    expect(buildExtensionContext).not.toHaveBeenCalled();
    expect(assembly.experimentalContext).toEqual({});
    expect(Object.keys(assembly.supportedTools)).toEqual(["send_message"]);
  });
});
