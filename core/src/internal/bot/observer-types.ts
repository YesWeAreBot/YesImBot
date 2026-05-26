import type { Bot, Session } from "koishi";

import type { BasePresenter } from "./presentation.js";
import type { AthenaEvent, AthenaEventKind } from "./types.js";

export type ObserverSource = { kind: "middleware" } | { kind: "koishi-event"; eventName: string };

export type HandleResult =
  | { type: "event"; event: AthenaEvent }
  | { type: "pass" }
  | { type: "drop" };

export interface ObserverInput {
  source: ObserverSource;
  eventName?: string;
  session?: Session;
  selfId?: string;
  args: unknown[];
}

export interface EventObserver {
  name: string;
  source: ObserverSource;
  priority: number;
  eventKinds: AthenaEventKind[];
  presenters?: Partial<Record<AthenaEventKind, BasePresenter>>;
  handle(input: ObserverInput): HandleResult | Promise<HandleResult>;
}

export interface ObservedEvent {
  event: AthenaEvent;
  bot: Bot;
  originSession?: Session;
}

export interface ChannelEventContext {
  originSession?: Session;
}
