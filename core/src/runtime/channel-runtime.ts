import type { AgentSession, SessionManager } from "@yesimbot/agent/session";
import type { Session } from "koishi";

import type { AthenaBot } from "../bot/athena-bot.js";
import { serializeAthenaEvent } from "../bot/events.js";
import type { AthenaEvent } from "../bot/types.js";
import type { Channel } from "../extension/types.js";
import { ChannelIdentifier } from "../shared/types.js";
import { WillingnessManager } from "./willing.js";

export interface ChannelRuntimeOptions {
  channel: Channel;
  bot: AthenaBot;
  agentSession: AgentSession;
  sessionManager: SessionManager;
  willingManager: WillingnessManager;
  allowedChannels: ChannelIdentifier[];
}

export interface ChannelRuntime {
  handleEvent(event: AthenaEvent): Promise<void>;
  dispose(): void;
}

export function createChannelRuntime(options: ChannelRuntimeOptions): ChannelRuntime {
  const { bot, agentSession, allowedChannels } = options;
  const pendingOriginSessions: Array<Session | undefined> = [];

  const unsubscribe = agentSession.subscribe((event) => {
    if (event.type !== "message_end") return;
    if (event.message.role !== "assistant") return;

    const text = event.message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("");

    if (!text) return;

    const originSession = pendingOriginSessions.shift();

    void bot
      .speak(text, {
        originSession,
        modelElapsedMs: 0,
      })
      .catch(() => undefined);
  });

  return {
    async handleEvent(event) {
      const channelAllowed = isChannelAllowed(
        event.source.platform,
        event.source.channelId,
        event.source.conversationType === "private" ? "private" : "group",
        allowedChannels,
      );

      const { decision, probability } = options.willingManager.shouldReply(
        event,
        event.metadata.triggerCandidate,
      );
      const shouldTriggerTurn = channelAllowed && (event.metadata.triggerCandidate || decision);

      if (!event.metadata.persist && !shouldTriggerTurn) {
        return;
      }

      const presentation = await bot.present(event);

      if (presentation === null && !event.metadata.persist) {
        return;
      }

      await agentSession.sendCustomMessage(
        {
          customType: "athena:event",
          content: presentation?.content ?? [],
          display: presentation?.visible ?? false,
          details:
            presentation?.details ??
            (event.metadata.persist ? serializeAthenaEvent(event) : undefined),
        },
        shouldTriggerTurn ? { triggerTurn: true, deliverAs: "followUp" } : { triggerTurn: false },
      );

      if (shouldTriggerTurn) {
        pendingOriginSessions.push(event.metadata.originSession);
      }
    },

    dispose() {
      unsubscribe();
      agentSession.dispose();
    },
  };
}

export function isChannelAllowed(
  platform: string,
  channelId: string,
  type: "private" | "group",
  allowedChannels: ChannelIdentifier[],
): boolean {
  return allowedChannels.some((channel) => {
    const platformMatch = channel.platform === "*" || channel.platform === platform;
    const channelMatch = channel.channelId === "*" || channel.channelId === channelId;
    return platformMatch && channelMatch && channel.type === type;
  });
}
