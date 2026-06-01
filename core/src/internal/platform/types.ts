import type { UserContent } from "@yesimbot/agent/ai";
import type { Bot, Fragment, Session } from "koishi";

import type {
  PlatformEvent,
  PlatformEventOf,
  PlatformEventPayloadMap,
  PlatformEventType,
} from "../../shared/platform-event.js";

// ============================================================================
// Gateway → Runtime contract
// ============================================================================

export interface GatewayEvent {
  event: PlatformEvent;
  content: UserContent;
  bot: Bot;
  originSession?: Session;
}

// ============================================================================
// Raw input for listener translate()
// ============================================================================

export interface RawEventInput {
  session?: Session;
  args: unknown[];
  selfId?: string;
}

// ============================================================================
// Listener translate result
// ============================================================================

export type TranslateResult<T extends PlatformEventType> =
  | { type: "event"; event: PlatformEventOf<T> }
  | { type: "pass" }
  | { type: "drop" };

// ============================================================================
// PlatformListener — input translator
// ============================================================================

export interface PlatformListener<T extends PlatformEventType = PlatformEventType> {
  name: string;
  eventType: T;
  source: { kind: "middleware" } | { kind: "koishi-event"; eventName: string };
  priority?: number;
  translate(input: RawEventInput): TranslateResult<T> | Promise<TranslateResult<T>>;
  renderContent(payload: PlatformEventPayloadMap[T]): UserContent;
}

// ============================================================================
// Delivery types
// ============================================================================

export interface DeliveryOptions {
  quoteMessageId?: string;
  originSession?: Session;
}

export interface DeliveryIssue {
  kind: "send_failed" | "cancelled" | "partial_failed";
  timestamp: number;
  reason: string;
  failedSegments: string[];
}

export interface DeliveryResult {
  ok: boolean;
  deliveredSegments: string[];
  failedSegments: string[];
  issue?: DeliveryIssue;
}

// ============================================================================
// PlatformAdapter — output adapter
// ============================================================================

export interface PlatformAdapter {
  platform: string;
  deliver(
    bot: Bot,
    channelId: string,
    segments: Fragment[],
    options?: DeliveryOptions,
  ): Promise<DeliveryResult>;
}
