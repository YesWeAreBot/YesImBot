import type { LanguageModel } from "ai";
import { describe, expect, it } from "vitest";

import { Agent } from "../../src/agent/agent.js";
import type { AgentTool } from "../../src/agent/types.js";
import { AgentSession } from "../../src/session/agent-session.js";
import type { HookContext } from "../../src/session/hook-runner.js";
import { HookRunner } from "../../src/session/hook-runner.js";
import { convertToLlm } from "../../src/session/messages.js";
import { SessionManager } from "../../src/session/session-manager.js";

function createMockModel(): LanguageModel {
  return {
    specificationVersion: "v3",
    provider: "test",
    modelId: "test-model",
    defaultObjectGenerationMode: "json",
    supportedUrls: {},
    doGenerate: async () => ({
      finishReason: "stop",
      usage: { promptTokens: 0, completionTokens: 0 },
      content: [],
      response: { id: "test", timestamp: new Date(), modelId: "test" },
      providerMetadata: undefined,
      request: { body: "{}" },
    }),
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
    }),
  } as LanguageModel;
}

function createTool(description: string): AgentTool {
  return {
    description,
    inputSchema: {} as never,
    execute: async () => "ok",
  };
}

function createHookRunner(sessionManager: SessionManager, agent: Agent): HookRunner {
  return new HookRunner(
    (): HookContext => ({
      sessionManager,
      model: agent.state.model,
      isIdle: () => !agent.state.isStreaming,
      signal: agent.signal,
      abort: () => agent.abort(),
      hasPendingMessages: () => agent.hasQueuedMessages(),
      getContextUsage: () => undefined,
      compact: () => {},
      getSystemPrompt: () => agent.state.systemPrompt,
    }),
  );
}

function createSession(config?: {
  customTools?: Map<string, AgentTool>;
  initialActiveToolNames?: string[];
}): AgentSession {
  const sessionManager = SessionManager.inMemory("/tmp/test");
  const agent = new Agent({
    model: createMockModel(),
    convertToLlm: (messages) => convertToLlm(messages),
  });

  return new AgentSession({
    agent,
    sessionManager,
    hookRunner: createHookRunner(sessionManager, agent),
    customTools: config?.customTools,
    initialActiveToolNames: config?.initialActiveToolNames,
  });
}

describe("AgentSession extension tool state", () => {
  it("keeps existing active tools and activates extension tools from a snapshot", () => {
    const session = createSession({
      customTools: new Map([["custom_tool", createTool("custom")]]),
      initialActiveToolNames: ["custom_tool"],
    });

    session.applyToolState({
      tools: new Map([["extension_tool", createTool("extension")]]),
    });

    expect(session.getActiveToolNames().sort()).toEqual(["custom_tool", "extension_tool"]);
    expect([...session.getAllTools().keys()].sort()).toEqual(["custom_tool", "extension_tool"]);
  });
});
