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

export function createDefaultChatMessagePresenter(): BasePresenter<"chat_message"> {
  return (event) => {
    const text = renderMessageText(event.payload.content);
    if (!text) return null;

    const actorName = event.actor.name?.trim() || "未知用户";
    const actorLabel = event.actor.name?.trim()
      ? `${actorName} (${event.actor.id})`
      : event.actor.id;

    return {
      visible: true,
      content: `[${formatTime(event.timestamp)}] ${actorLabel}: ${text}`,
      text: `${actorName}: ${text}`,
      details: serializeAthenaEvent(event),
    };
  };
}

function renderMessageText(content: string): string {
  const normalized = content.trim();
  return normalized.length > 0 ? normalized : "";
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}
