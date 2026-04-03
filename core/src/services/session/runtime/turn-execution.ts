import type { ModelMessage } from "@ai-sdk/provider-utils";
import type { ToolSet } from "ai";
import type { ToolLoopAgent } from "ai";
import type { Bot, Context, Logger } from "koishi";

import { DefaultSessionResourceLoader } from "../resource-loader";
import type { SessionManager } from "../session-manager";
import {
  buildGenerateInputForTest,
  PROTOCOL_GUIDANCE_TEXT,
} from "./response-step-processor";
import type {
  ChannelRuntimeSettingsManager,
  ChannelRuntimeTurnSettingsSnapshot,
} from "./types";
import { buildResponseToolSet } from "./workspace-tools";

export interface RuntimeTurnExecutionOptions {
  ctx: Context;
  logger: Logger;
  bot: Bot;
  sessionManager: SessionManager;
  settingsManager: ChannelRuntimeSettingsManager;
  channelId: string;
  basePath: string;
  turnSettings: ChannelRuntimeTurnSettingsSnapshot;
  protocolRetry: boolean;
  abortSignal: AbortSignal;
  createAgent: (turnSettings: ChannelRuntimeTurnSettingsSnapshot) => ToolLoopAgent<never, ToolSet>;
}

export interface RuntimeTurnExecutionResult {
  responseToolSnapshot: ToolSet;
  responseActiveTools: string[];
}

export async function executeRuntimeTurn(
  options: RuntimeTurnExecutionOptions,
): Promise<RuntimeTurnExecutionResult> {
  const resourceLoader = new DefaultSessionResourceLoader({
    channelDir: options.basePath,
    settingsManager: options.settingsManager,
    logger: options.logger,
  });
  resourceLoader.reload();

  const instructions = resourceLoader.buildSystemPrompt();
  const sessionEntries = [...options.sessionManager.getEntries()];
  const { messages: baseMessages } = buildGenerateInputForTest({
    instructions,
    sessionEntries,
  });
  const retryGuidanceMessage = options.protocolRetry
    ? ({ role: "user", content: PROTOCOL_GUIDANCE_TEXT } as const)
    : undefined;
  const messages = retryGuidanceMessage
    ? [...baseMessages, retryGuidanceMessage]
    : baseMessages;
  const modelMessages = messages as ModelMessage[];

  const pluginTools = options.ctx["yesimbot.plugin"]?.getToolSet() ?? {};
  const responseToolSnapshot = await buildResponseToolSet({
    bot: options.bot,
    channelId: options.channelId,
    pluginTools,
    workspace: {
      basePath: options.basePath,
      settingsManager: options.settingsManager,
      logger: options.logger,
    },
  });
  const responseActiveTools = Object.keys(responseToolSnapshot);

  const agent = options.createAgent(options.turnSettings);
  Object.assign(agent.tools, responseToolSnapshot);

  if (options.turnSettings.streaming) {
    const result = await abortable(options.abortSignal, () =>
      agent.stream({
        messages: modelMessages,
        abortSignal: options.abortSignal,
      }),
    );
    await abortable(options.abortSignal, () => result.consumeStream());
  } else {
    await abortable(options.abortSignal, () =>
      agent.generate({
        messages: modelMessages,
        abortSignal: options.abortSignal,
      }),
    );
  }

  return {
    responseToolSnapshot,
    responseActiveTools,
  };
}

async function abortable<T>(
  signal: AbortSignal,
  operation: () => PromiseLike<T>,
): Promise<T> {
  if (signal.aborted) {
    throw new Error("aborted");
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(new Error("aborted"));
    };

    signal.addEventListener("abort", onAbort, { once: true });

    operation().then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
