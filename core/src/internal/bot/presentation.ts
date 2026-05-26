import { serializeAthenaEvent } from "./events.js";
import type { AthenaEvent, AthenaEventKind, BotPresentation } from "./types.js";

export interface PresentationContext {
  selfId: string;
}

export type BasePresenter<K extends AthenaEventKind = AthenaEventKind> = (
  event: AthenaEvent<K>,
  context: PresentationContext,
) => BotPresentation | null | Promise<BotPresentation | null>;

export interface PresenterRegistry {
  registerBase<K extends AthenaEventKind>(kind: K, presenter: BasePresenter<K>): () => void;
  present(event: AthenaEvent, context: PresentationContext): Promise<BotPresentation | null>;
}

export interface PresenterCatalog {
  registerBase<K extends AthenaEventKind>(kind: K, presenter: BasePresenter<K>): () => void;
  has(kind: AthenaEventKind): boolean;
  applyTo(registry: PresenterRegistry): void;
}

export function createPresenterRegistry(): PresenterRegistry {
  const presenters = new Map<AthenaEventKind, BasePresenter>();

  return {
    registerBase(kind, presenter) {
      if (presenters.has(kind)) {
        throw new Error(`Base presenter for "${String(kind)}" is already registered`);
      }

      presenters.set(kind, presenter as BasePresenter);

      return () => {
        if (presenters.get(kind) === presenter) {
          presenters.delete(kind);
        }
      };
    },

    async present(event, context) {
      const presenter = presenters.get(event.kind);
      if (!presenter) return null;
      return (await presenter(event as never, context)) ?? null;
    },
  };
}

export function createPresenterCatalog(): PresenterCatalog {
  const presenters = new Map<AthenaEventKind, BasePresenter>();

  return {
    registerBase(kind, presenter) {
      if (presenters.has(kind)) {
        throw new Error(`Base presenter for "${String(kind)}" is already registered`);
      }

      presenters.set(kind, presenter as BasePresenter);

      return () => {
        if (presenters.get(kind) === presenter) {
          presenters.delete(kind);
        }
      };
    },

    has(kind) {
      return presenters.has(kind);
    },

    applyTo(registry) {
      for (const [kind, presenter] of presenters) {
        registry.registerBase(kind, presenter);
      }
    },
  };
}

export function createDefaultChatMessagePresenter(): BasePresenter<"chat_message"> {
  return (event) => {
    const text = renderMessageText(event.payload.content);
    if (!text) return null;

    const actorName = event.actor.name?.trim() || "未知用户";
    const actorLabel = formatActorLabel(event.actor);

    return {
      visible: true,
      content: `[${formatTime(event.timestamp)}] ${actorLabel}: ${text}`,
      text: `${actorName}: ${text}`,
      details: serializeAthenaEvent(event),
    };
  };
}

export function createDefaultMessageRecallPresenter(): BasePresenter<"message_recall"> {
  return (event) => {
    const actorName = formatActorName(event.actor);
    const original = event.payload.originalSender
      ? ` originally sent by ${formatActorName(event.payload.originalSender)}`
      : "";
    const text = `${actorName} recalled message ${event.payload.messageId}${original}`;

    return {
      visible: true,
      content: `[${formatTime(event.timestamp)}] ${text}`,
      text,
      details: serializeAthenaEvent(event),
    };
  };
}

export function createDefaultReactionPresenter(): BasePresenter<"reaction"> {
  return (event) => {
    const actorName = formatActorName(event.actor);
    const action = event.payload.action === "add" ? "reacted" : "removed reaction";
    const text = `${actorName} ${action} ${event.payload.emoji} to message ${event.payload.messageId}`;

    return {
      visible: true,
      content: `[${formatTime(event.timestamp)}] ${text}`,
      text,
      details: serializeAthenaEvent(event),
    };
  };
}

export function createDefaultMemberChangePresenter(): BasePresenter<"member_change"> {
  return (event) => {
    const targetName = event.target ? formatActorName(event.target) : "Unknown member";
    const text = `${targetName} ${formatMemberAction(event.payload.action)} group ${event.payload.groupId}`;

    return {
      visible: true,
      content: `[${formatTime(event.timestamp)}] ${text}`,
      text,
      details: serializeAthenaEvent(event),
    };
  };
}

function renderMessageText(content: string): string {
  const normalized = content.trim();
  return normalized.length > 0 ? normalized : "";
}

function formatActorName(actor: { id: string; name?: string }): string {
  return actor.name?.trim() || actor.id;
}

function formatActorLabel(actor: { id: string; name?: string }): string {
  const actorName = actor.name?.trim();
  return actorName ? `${actorName} (${actor.id})` : actor.id;
}

function formatMemberAction(action: string): string {
  switch (action) {
    case "join":
      return "joined";
    case "leave":
      return "left";
    case "kick":
      return "was kicked from";
    case "ban":
      return "was banned from";
    case "unban":
      return "was unbanned from";
    default:
      return "changed membership in";
  }
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}
