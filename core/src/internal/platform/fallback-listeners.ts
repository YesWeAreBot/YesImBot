import { randomUUID } from "node:crypto";

import type { UserContent } from "@yesimbot/agent/ai";
import type { Session } from "koishi";

import type { MessagePayload } from "../../shared/platform-event.js";
import type { PlatformListener, RawEventInput, TranslateResult } from "./types.js";

export function createFallbackListeners(): PlatformListener[] {
  return [
    coreMessageListener(),
    messageRecallListener(),
    reactionAddedListener(),
    reactionRemovedListener(),
    memberAddedListener(),
    memberRemovedListener(),
  ];
}

// ============================================================================
// core.message — 完整实现
// ============================================================================

function coreMessageListener(): PlatformListener<"message"> {
  return {
    name: "core.message",
    eventType: "message",
    source: { kind: "middleware" },
    priority: 0,
    translate(input: RawEventInput): TranslateResult<"message"> {
      const session = input.session;
      if (!session) return { type: "pass" };
      if (!session.channelId) return { type: "pass" };

      const text = session.stripped?.content ?? session.content ?? "";
      const selfId = input.selfId ?? session.bot?.selfId;
      const userId = session.author?.id ?? session.userId ?? "unknown";
      const isSelf = userId === selfId;
      const messageId = session.messageId ?? randomUUID();

      const payload: MessagePayload = {
        messageId,
        content: text,
      };

      return {
        type: "event",
        event: {
          id: randomUUID(),
          type: "message",
          timestamp: Date.now(),
          source: {
            platform: session.platform,
            channelId: session.channelId,
            guildId: session.guildId,
            sourceType: session.isDirect ? "private" : "group",
            selfId,
          },
          actor: {
            id: userId,
            name: session.author?.name ?? session.author?.nick,
            avatar: session.author?.avatar,
            isSelf,
          },
          visible: true,
          payload,
          metadata: {
            persist: true,
            triggerCandidate: detectTrigger(text, session, isSelf),
          },
        },
      };
    },
    renderContent(payload: MessagePayload): UserContent {
      return [{ type: "text", text: payload.content }];
    },
  };
}

function detectTrigger(text: string, session: Session, isSelf: boolean): boolean {
  if (isSelf) return false;
  if (session.subtype === "private") return true;
  if (session.stripped?.atSelf) return true;
  // Check for @ elements in parsed content
  if (session.elements?.some((el: { type: string }) => el.type === "at")) return true;
  return false;
}

// ============================================================================
// 占位 listeners — 仅 log + pass
// ============================================================================

function stubbed(name: string, eventName: string): PlatformListener<"message"> {
  return {
    name,
    eventType: "message",
    source: { kind: "koishi-event", eventName },
    translate(): TranslateResult<"message"> {
      return { type: "pass" };
    },
    renderContent(): UserContent {
      throw new Error(`stub listener ${name} should never produce an event`);
    },
  };
}

function messageRecallListener(): PlatformListener<"message"> {
  return stubbed("core.message-deleted", "message-deleted");
}

function reactionAddedListener(): PlatformListener<"message"> {
  return stubbed("core.reaction-added", "reaction-added");
}

function reactionRemovedListener(): PlatformListener<"message"> {
  return stubbed("core.reaction-removed", "reaction-removed");
}

function memberAddedListener(): PlatformListener<"message"> {
  return stubbed("core.guild-member-added", "guild-member-added");
}

function memberRemovedListener(): PlatformListener<"message"> {
  return stubbed("core.guild-member-removed", "guild-member-removed");
}
