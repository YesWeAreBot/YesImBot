import { randomUUID } from "node:crypto";

import type { Session } from "koishi";

import type { PlatformEvent, PlatformEventType } from "../../shared/platform-event.js";
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

function coreMessageListener(): PlatformListener {
  return {
    name: "core.message",
    eventType: "message" as PlatformEventType,
    source: { kind: "middleware" },
    priority: 0,
    translate(input: RawEventInput): TranslateResult {
      const session = input.session;
      if (!session) return { type: "pass" };
      if (!session.channelId) return { type: "pass" };

      const text = session.stripped?.content ?? session.content ?? "";
      const selfId = input.selfId ?? session.bot?.selfId;
      const userId = session.author?.id ?? session.userId ?? "unknown";
      const isSelf = userId === selfId;

      const event: PlatformEvent = {
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
        content: [{ type: "text", text }],
        visible: true,
        details: session,
        metadata: {
          persist: true,
          triggerCandidate: detectTrigger(text, session, isSelf),
        },
      };

      return { type: "event", event };
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

function stubbed(name: string, eventType: PlatformEventType, eventName: string): PlatformListener {
  return {
    name,
    eventType,
    source: { kind: "koishi-event", eventName },
    translate(_input: RawEventInput): TranslateResult {
      return { type: "pass" };
    },
  };
}

function messageRecallListener(): PlatformListener {
  return stubbed("core.message-deleted", "message.recall", "message-deleted");
}

function reactionAddedListener(): PlatformListener {
  return stubbed("core.reaction-added", "reaction", "reaction-added");
}

function reactionRemovedListener(): PlatformListener {
  return stubbed("core.reaction-removed", "reaction", "reaction-removed");
}

function memberAddedListener(): PlatformListener {
  return stubbed("core.guild-member-added", "member", "guild-member-added");
}

function memberRemovedListener(): PlatformListener {
  return stubbed("core.guild-member-removed", "member", "guild-member-removed");
}
