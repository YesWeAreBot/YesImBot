import { h, type Bot, type Fragment, type Session } from "koishi";

import type { Channel } from "../extension/types.js";
import { planDeliveryTiming } from "../runtime/delivery/timing.js";
import type { DeliverySettings } from "../runtime/delivery/types.js";
import { createAthenaEvent } from "./events.js";
import type { PresenterRegistry } from "./presenter.js";
import type { SpeakElementRegistry } from "./speak-elements.js";
import type { AthenaEvent, BotPresentation, ChatMessagePayload, SpeakAnomaly } from "./types.js";

export interface AthenaBotOptions {
  channel: Channel;
  presenters: PresenterRegistry;
  speakElements: SpeakElementRegistry;
  deliverySettings: DeliverySettings;
  appendEntry(customType: string, data?: unknown): void;
}

export interface SpeakOptions {
  originSession?: Session;
  modelElapsedMs?: number;
  signal?: AbortSignal;
}

export interface SpeakResult {
  ok: boolean;
  attemptedSegments: string[];
  deliveredSegments: string[];
  failedSegments: string[];
  anomalies: SpeakAnomaly[];
}

export class AthenaBot {
  private readonly channel: Channel;
  private readonly presenters: PresenterRegistry;
  private readonly speakElements: SpeakElementRegistry;
  private readonly deliverySettings: DeliverySettings;
  private readonly appendEntry: AthenaBotOptions["appendEntry"];
  private seedCounter = 0;

  constructor(options: AthenaBotOptions) {
    this.channel = options.channel;
    this.presenters = options.presenters;
    this.speakElements = options.speakElements;
    this.deliverySettings = options.deliverySettings;
    this.appendEntry = options.appendEntry;
  }

  observe(session: Session): AthenaEvent | null {
    const sessionType = getSessionType(session);
    if (!sessionType) return null;

    if (sessionType === "message") {
      return this.observeChatMessage(session);
    }

    if (sessionType === "message-deleted") {
      return observeMessageRecall(session);
    }

    if (sessionType === "reaction-added" || sessionType === "reaction-removed") {
      return observeReaction(session, sessionType === "reaction-added" ? "add" : "remove");
    }

    if (sessionType === "guild-member-added" || sessionType === "guild-member-removed") {
      return observeMemberChange(session, sessionType === "guild-member-added" ? "join" : "leave");
    }

    return null;
  }

  private observeChatMessage(session: Session): AthenaEvent<"chat_message"> | null {
    if (!session.platform || !session.channelId || !session.messageId) return null;

    const isMentioned =
      session.stripped?.atSelf ||
      session.elements?.some(
        (element) => element.type === "at" && String(element.attrs.id) === session.bot?.selfId,
      ) ||
      false;

    return createAthenaEvent("chat_message", {
      source: {
        platform: session.platform,
        channelId: session.channelId,
        conversationType: session.isDirect ? "private" : "group",
      },
      actor: {
        id: session.author?.id ?? session.userId ?? "unknown",
        name: session.author?.name ?? session.author?.nick,
        avatar: session.author?.avatar,
        isSelf: session.author?.id === session.bot?.selfId,
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
      } satisfies ChatMessagePayload,
      metadata: {
        persist: true,
        triggerCandidate: session.isDirect || isMentioned,
        originSession: session,
      },
    });
  }

  present(event: AthenaEvent): Promise<BotPresentation | null> {
    return this.presenters.present(event, { selfId: this.channel.bot?.selfId ?? "unknown" });
  }

  async speak(content: string | Fragment, options: SpeakOptions = {}): Promise<SpeakResult> {
    const compiled = await this.speakElements.compile(content, {
      channel: this.channel,
      session: options.originSession,
    });
    const attemptedSegments = compiled.segments.map(stringifyFragment);
    const deliveredSegments: string[] = [];
    const failedSegments: string[] = [];
    const anomalies = [...compiled.anomalies];
    const timing = planDeliveryTiming({
      modelElapsedMs: options.modelElapsedMs ?? 0,
      initialDelayMinMs: this.deliverySettings.timing.initialDelayMinMs,
      initialDelayMaxMs: this.deliverySettings.timing.initialDelayMaxMs,
      followupDelayMinMs: this.deliverySettings.timing.followupDelayMinMs,
      followupDelayMaxMs: this.deliverySettings.timing.followupDelayMaxMs,
      minimumBufferMinMs: this.deliverySettings.timing.minimumBufferMinMs,
      minimumBufferMaxMs: this.deliverySettings.timing.minimumBufferMaxMs,
      segmentCount: compiled.segments.length,
      seed: this.nextSeed(),
    });

    for (const [index, segment] of compiled.segments.entries()) {
      const delay = index === 0 ? timing.firstDelayMs : (timing.followupDelaysMs[index - 1] ?? 0);
      if (delay > 0) {
        await sleep(delay, options.signal);
      }

      if (options.signal?.aborted) {
        const remaining = attemptedSegments.slice(index);
        failedSegments.push(...remaining);
        anomalies.push(
          createSpeakAnomaly("cancelled", "speak cancelled", content, attemptedSegments, {
            deliveredSegments,
            failedSegments: remaining,
          }),
        );
        break;
      }

      try {
        await this.sendFragment(segment, options.originSession);
        deliveredSegments.push(attemptedSegments[index]);
      } catch (error) {
        const failed = attemptedSegments[index];
        failedSegments.push(failed);
        anomalies.push(
          createSpeakAnomaly("send_failed", getErrorMessage(error), content, attemptedSegments, {
            deliveredSegments,
            failedSegments: [failed],
            error,
          }),
        );
      }
    }

    if (failedSegments.length > 0 && deliveredSegments.length > 0) {
      anomalies.push(
        createSpeakAnomaly(
          "partial_failed",
          `${failedSegments.length} segment(s) failed`,
          content,
          attemptedSegments,
          { deliveredSegments, failedSegments },
        ),
      );
    }

    this.persistSpeakAnomalies(anomalies);

    return {
      ok: failedSegments.length === 0,
      attemptedSegments,
      deliveredSegments,
      failedSegments,
      anomalies,
    };
  }

  persistSpeakAnomalies(anomalies: SpeakAnomaly[]): void {
    for (const anomaly of anomalies) {
      this.appendEntry("athena:speak_anomaly", {
        display: false,
        details: anomaly,
      });
    }
  }

  registerSpeakElement(definition: Parameters<SpeakElementRegistry["register"]>[0]): () => void {
    return this.speakElements.register(definition);
  }

  getSpeakElementPrompts() {
    return this.speakElements.getPromptElements();
  }

  private async sendFragment(fragment: Fragment, originSession?: Session): Promise<void> {
    const message = toOutgoingMessage(fragment);

    if (originSession) {
      await originSession.send(message);
      return;
    }

    const bot = this.channel.bot as Bot | undefined;
    if (!bot) {
      throw new Error("No Koishi bot available for active send");
    }

    await bot.sendMessage(this.channel.channelId, message);
  }

  private nextSeed(): number {
    return Date.now() + this.seedCounter++;
  }
}

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

function observeMessageRecall(session: Session): AthenaEvent<"message_recall"> | null {
  const source = getEventSource(session);
  const messageId = getMessageId(session);
  if (!source || !messageId) return null;

  const originalSender = toActor(getSessionEvent(session)?.message?.user) ?? undefined;

  return createAthenaEvent("message_recall", {
    source,
    actor: getPassiveActor(session),
    payload: {
      messageId,
      originalSender,
    },
    metadata: createPassiveMetadata(session),
  });
}

function observeReaction(
  session: Session,
  action: "add" | "remove",
): AthenaEvent<"reaction"> | null {
  const source = getEventSource(session);
  const messageId = getMessageId(session);
  const emoji = getReactionEmoji(session);
  if (!source || !messageId || !emoji) return null;

  return createAthenaEvent("reaction", {
    source,
    actor: getPassiveActor(session),
    payload: {
      messageId,
      emoji,
      action,
    },
    metadata: createPassiveMetadata(session),
  });
}

function observeMemberChange(
  session: Session,
  action: "join" | "leave",
): AthenaEvent<"member_change"> | null {
  const source = getEventSource(session);
  const groupId = source?.guildId ?? session.guildId;
  const target = getMemberTarget(session);
  if (!source || !groupId || !target) return null;

  return createAthenaEvent("member_change", {
    source,
    actor: getMemberChangeActor(session, action, target),
    target,
    payload: {
      action,
      groupId,
    },
    metadata: createPassiveMetadata(session),
  });
}

function getSessionType(session: Session): string | undefined {
  return session.type ?? getSessionEvent(session)?.type;
}

function getSessionEvent(session: Session): SessionEventShape | undefined {
  return session.event as SessionEventShape | undefined;
}

function getEventSource(session: Session) {
  const event = getSessionEvent(session);
  const platform = session.platform ?? event?.platform;
  const channelId = session.channelId ?? event?.channel?.id;
  if (!platform || !channelId) return null;

  return {
    platform,
    channelId,
    guildId: session.guildId ?? event?.guild?.id,
    conversationType: session.isDirect ? "private" : "group",
  } as const;
}

function getActor(session: Session) {
  return (
    toActor(getSessionEvent(session)?.operator, session.bot?.selfId) ??
    toActor(session.author, session.bot?.selfId) ??
    toActor(getSessionEvent(session)?.user, session.bot?.selfId) ?? {
      id: session.userId ?? "unknown",
      isSelf: session.userId === session.bot?.selfId,
    }
  );
}

function getPassiveActor(session: Session) {
  return (
    toActor(getSessionEvent(session)?.operator, session.bot?.selfId) ??
    toActor(getSessionEvent(session)?.user, session.bot?.selfId) ??
    toActor(session.author, session.bot?.selfId) ??
    getActor(session)
  );
}

function getMemberTarget(session: Session) {
  const event = getSessionEvent(session);
  return (
    mergeActor(event?.member, event?.user, session.bot?.selfId) ??
    toActor(session.author, session.bot?.selfId) ??
    toActor(event?.user, session.bot?.selfId)
  );
}

function getMemberChangeActor(
  session: Session,
  action: "join" | "leave",
  target: NonNullable<ReturnType<typeof getMemberTarget>>,
) {
  const actor = toActor(getSessionEvent(session)?.operator, session.bot?.selfId);
  if (actor) return actor;
  if (action === "leave") return target;
  return getActor(session);
}

function getMessageId(session: Session): string | undefined {
  return getSessionEvent(session)?.message?.id ?? session.messageId;
}

function getReactionEmoji(session: Session): string | undefined {
  const emoji = getSessionEvent(session)?.emoji;
  if (typeof emoji === "string") return emoji;
  return emoji?.name;
}

function createPassiveMetadata(session: Session) {
  return {
    persist: true,
    triggerCandidate: false,
    originSession: session,
  } as const;
}

function toActor(resource: SessionResource | null | undefined, selfId?: string) {
  if (!resource?.id) return null;
  return {
    id: resource.id,
    name: resource.name ?? resource.nick,
    avatar: resource.avatar,
    isSelf: resource.id === selfId,
  };
}

function mergeActor(
  primary: SessionResource | null | undefined,
  fallback: SessionResource | null | undefined,
  selfId?: string,
) {
  const merged = {
    ...(fallback ?? {}),
    ...(primary ?? {}),
  };

  return toActor(merged, selfId);
}

function toOutgoingMessage(fragment: Fragment): string | Fragment {
  if (typeof fragment === "string") {
    return fragment;
  }

  if (Array.isArray(fragment) && fragment.every((item) => typeof item === "string")) {
    return fragment.join("");
  }

  return fragment;
}

function stringifyFragment(fragment: Fragment): string {
  if (typeof fragment === "string") {
    return fragment;
  }

  if (Array.isArray(fragment) && fragment.every((item) => typeof item === "string")) {
    return fragment.join("");
  }

  return h("", fragment).toString();
}

function createSpeakAnomaly(
  kind: SpeakAnomaly["kind"],
  reason: string,
  generatedContent: string | Fragment,
  attemptedSegments: string[],
  extras: {
    deliveredSegments?: string[];
    failedSegments?: string[];
    error?: unknown;
  } = {},
): SpeakAnomaly {
  return {
    version: 1,
    kind,
    timestamp: Date.now(),
    source: "athena-bot",
    reason,
    generatedContent: stringifyFragment(generatedContent),
    attemptedSegments,
    ...(extras.deliveredSegments?.length ? { deliveredSegments: extras.deliveredSegments } : {}),
    ...(extras.failedSegments?.length ? { failedSegments: extras.failedSegments } : {}),
    ...(extras.error !== undefined ? { error: serializeError(extras.error) } : {}),
  };
}

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack !== undefined ? { stack: error.stack } : {}),
    };
  }

  return error;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0 || signal?.aborted) {
      resolve();
      return;
    }

    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
