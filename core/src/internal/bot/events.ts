import { randomUUID } from "node:crypto";

import type { Session } from "koishi";

import type { EventObserver, HandleResult, ObserverInput } from "./observer-types.js";
import type {
  AthenaEvent,
  AthenaEventKind,
  CreateAthenaEventInput,
  EventSource,
  SerializedAthenaEvent,
} from "./types.js";

const CORE_PRIORITY = 0;

type SessionResource = {
  id?: string;
  name?: string;
  nick?: string;
  avatar?: string;
  type?: number | string;
  user?: SessionResource;
  message?: SessionResource;
  channel?: SessionResource;
  guild?: SessionResource;
  member?: SessionResource;
  operator?: SessionResource;
  emoji?: { name?: string } | string;
};

type SessionEventShape = {
  type?: string;
  platform?: string;
  channel?: SessionResource;
  guild?: SessionResource;
  message?: SessionResource;
  user?: SessionResource;
  member?: SessionResource;
  operator?: SessionResource;
  emoji?: { name?: string } | string;
};

export function createAthenaEvent<K extends AthenaEventKind>(
  kind: K,
  input: CreateAthenaEventInput<K>,
): AthenaEvent<K> {
  return {
    id: randomUUID(),
    kind,
    timestamp: Date.now(),
    ...input,
  };
}

export function isAthenaEvent<K extends AthenaEventKind>(
  event: AthenaEvent,
  kind: K,
): event is AthenaEvent<K> {
  return event.kind === kind;
}

export function serializeAthenaEvent<K extends AthenaEventKind>(
  event: AthenaEvent<K>,
): SerializedAthenaEvent<K> {
  const { metadata: _metadata, ...rest } = event;
  return { version: 1, ...rest };
}

export function createCoreFallbackObservers(): EventObserver[] {
  return [
    {
      name: "core.message",
      source: { kind: "middleware" },
      priority: CORE_PRIORITY,
      eventKinds: ["chat_message"],
      handle: observeChatMessage,
    },
    {
      name: "core.message-deleted",
      source: { kind: "koishi-event", eventName: "message-deleted" },
      priority: CORE_PRIORITY,
      eventKinds: ["message_recall"],
      handle: observeMessageRecall,
    },
    {
      name: "core.reaction-added",
      source: { kind: "koishi-event", eventName: "reaction-added" },
      priority: CORE_PRIORITY,
      eventKinds: ["reaction"],
      handle: (input) => observeReaction(input, "add"),
    },
    {
      name: "core.reaction-removed",
      source: { kind: "koishi-event", eventName: "reaction-removed" },
      priority: CORE_PRIORITY,
      eventKinds: ["reaction"],
      handle: (input) => observeReaction(input, "remove"),
    },
    {
      name: "core.guild-member-added",
      source: { kind: "koishi-event", eventName: "guild-member-added" },
      priority: CORE_PRIORITY,
      eventKinds: ["member_change"],
      handle: (input) => observeMemberChange(input, "join"),
    },
    {
      name: "core.guild-member-removed",
      source: { kind: "koishi-event", eventName: "guild-member-removed" },
      priority: CORE_PRIORITY,
      eventKinds: ["member_change"],
      handle: (input) => observeMemberChange(input, "leave"),
    },
  ];
}

function observeChatMessage(input: ObserverInput): HandleResult {
  const session = input.session;
  if (!session) return { type: "pass" };
  const event = createChatMessageEvent(session, input.selfId);
  return event ? { type: "event", event } : { type: "drop" };
}

function observeMessageRecall(input: ObserverInput): HandleResult {
  const session = input.session;
  if (!session) return { type: "pass" };
  const source = getEventSource(session, input.selfId);
  const messageId = getMessageId(session);
  if (!source || !messageId) return { type: "drop" };

  const originalSender =
    toActor(getSessionEvent(session)?.message?.user, input.selfId) ?? undefined;

  return {
    type: "event",
    event: createAthenaEvent("message_recall", {
      source,
      actor: getPassiveActor(session, input.selfId),
      payload: {
        messageId,
        originalSender,
      },
      metadata: createMetadata(false),
    }),
  };
}

function observeReaction(input: ObserverInput, action: "add" | "remove"): HandleResult {
  const session = input.session;
  if (!session) return { type: "pass" };
  const source = getEventSource(session, input.selfId);
  const messageId = getMessageId(session);
  const emoji = getReactionEmoji(session);
  if (!source || !messageId || !emoji) return { type: "drop" };

  return {
    type: "event",
    event: createAthenaEvent("reaction", {
      source,
      actor: getPassiveActor(session, input.selfId),
      payload: {
        messageId,
        emoji,
        action,
      },
      metadata: createMetadata(false),
    }),
  };
}

function observeMemberChange(input: ObserverInput, action: "join" | "leave"): HandleResult {
  const session = input.session;
  if (!session) return { type: "pass" };
  const source = getEventSource(session, input.selfId);
  const groupId = source?.guildId ?? session.guildId;
  const target = getMemberTarget(session, input.selfId);
  if (!source || !groupId || !target) return { type: "drop" };

  return {
    type: "event",
    event: createAthenaEvent("member_change", {
      source,
      actor: getMemberChangeActor(session, action, target, input.selfId),
      target,
      payload: {
        action,
        groupId,
      },
      metadata: createMetadata(false),
    }),
  };
}

function createChatMessageEvent(
  session: Session,
  selfId?: string,
): AthenaEvent<"chat_message"> | null {
  if (!session.platform || !session.channelId || !session.messageId) return null;

  const isMentioned =
    session.stripped?.atSelf ||
    session.elements?.some(
      (element) => element.type === "at" && String(element.attrs.id) === selfId,
    ) ||
    false;

  return createAthenaEvent("chat_message", {
    source: {
      platform: session.platform,
      channelId: session.channelId,
      conversationType: session.isDirect ? "private" : "group",
      ...(selfId ? { selfId } : {}),
    },
    actor: {
      id: session.author?.id ?? session.userId ?? "unknown",
      name: session.author?.name ?? session.author?.nick,
      avatar: session.author?.avatar,
      isSelf: session.author?.id === selfId,
    },
    payload: {
      messageId: session.messageId,
      content: session.content ?? "",
      quoteMessageId: session.quote?.id,
      quoteSender: session.quote?.user
        ? {
            id: session.quote.user.id,
            name: session.quote.user.name ?? session.quote.user.nick,
          }
        : undefined,
    },
    metadata: createMetadata(Boolean(session.isDirect || isMentioned)),
  });
}

function getSessionEvent(session: Session): SessionEventShape | undefined {
  return session.event as SessionEventShape | undefined;
}

function getEventSource(session: Session, selfId?: string): EventSource | undefined {
  const event = getSessionEvent(session);
  const platform = session.platform ?? event?.platform;
  const channelId = session.channelId ?? event?.channel?.id;
  if (!platform || !channelId) return undefined;

  return {
    platform,
    channelId,
    guildId: session.guildId ?? event?.guild?.id,
    conversationType: session.isDirect ? "private" : "group",
    ...(selfId ? { selfId } : {}),
  };
}

function getActor(session: Session, selfId?: string) {
  return (
    toActor(getSessionEvent(session)?.operator, selfId) ??
    toActor(session.author, selfId) ??
    toActor(getSessionEvent(session)?.user, selfId) ?? {
      id: session.userId ?? "unknown",
      isSelf: session.userId === selfId,
    }
  );
}

function getPassiveActor(session: Session, selfId?: string) {
  return (
    toActor(getSessionEvent(session)?.operator, selfId) ??
    toActor(getSessionEvent(session)?.user, selfId) ??
    toActor(session.author, selfId) ??
    getActor(session, selfId)
  );
}

function getMemberTarget(session: Session, selfId?: string) {
  const event = getSessionEvent(session);
  return (
    toActor(event?.member, selfId) ??
    toActor(event?.user, selfId) ??
    toActor(session.author, selfId)
  );
}

function getMemberChangeActor(
  session: Session,
  action: "join" | "leave",
  target: NonNullable<ReturnType<typeof getMemberTarget>>,
  selfId?: string,
) {
  const actor = toActor(getSessionEvent(session)?.operator, selfId);
  if (actor) return actor;
  if (action === "leave") return target;
  return getActor(session, selfId);
}

function getMessageId(session: Session): string | undefined {
  return getSessionEvent(session)?.message?.id ?? session.messageId;
}

function getReactionEmoji(session: Session): string | undefined {
  const emoji = getSessionEvent(session)?.emoji;
  if (typeof emoji === "string") return emoji;
  return emoji?.name;
}

function createMetadata(triggerCandidate: boolean): AthenaEvent["metadata"] {
  return { persist: true, triggerCandidate };
}

function toActor(resource: SessionResource | undefined, selfId?: string) {
  const user = resource?.user ?? resource;
  const id = user?.id;
  if (!id) return null;
  return {
    id,
    name: user?.name ?? user?.nick ?? resource?.name ?? resource?.nick,
    avatar: user?.avatar ?? resource?.avatar,
    isSelf: id === selfId,
  };
}
