import type { UserContent } from "@yesimbot/agent/ai";
import { describe, expectTypeOf, it } from "vitest";

import type {
  GatewayEvent,
  PlatformListener,
  TranslateResult,
} from "../../src/internal/platform/types.js";
import type {
  Actor,
  EventMetadata,
  EventSource,
  MessagePayload,
  PlatformEvent,
  PlatformEventOf,
  PlatformEventPayloadMap,
  PlatformEventType,
  UnknownPlatformEvent,
} from "../../src/shared/platform-event.js";
import { isPlatformEventOf } from "../../src/shared/platform-event.js";

describe("PlatformEvent type model", () => {
  it("PlatformEventType is keyof PayloadMap", () => {
    expectTypeOf<PlatformEventType>().toEqualTypeOf<keyof PlatformEventPayloadMap>();
    expectTypeOf<PlatformEventType>().toEqualTypeOf<"message">();
  });

  it("PlatformEventOf<'message'> binds payload to MessagePayload", () => {
    expectTypeOf<PlatformEventOf<"message">["payload"]>().toEqualTypeOf<MessagePayload>();
    expectTypeOf<PlatformEventOf<"message">["type"]>().toEqualTypeOf<"message">();
  });

  it("PlatformEvent is the production-only known event union", () => {
    expectTypeOf<PlatformEvent>().toEqualTypeOf<PlatformEventOf<"message">>();
    expectTypeOf<UnknownPlatformEvent>().not.toMatchTypeOf<PlatformEvent>();
  });

  it("isPlatformEventOf narrows payload", () => {
    const e = {} as PlatformEvent | UnknownPlatformEvent;
    if (isPlatformEventOf(e, "message")) {
      expectTypeOf(e.payload).toEqualTypeOf<MessagePayload>();
      expectTypeOf(e.type).toEqualTypeOf<"message">();
    }
  });

  it("EventSource / Actor / EventMetadata shapes are stable", () => {
    expectTypeOf<EventSource["sourceType"]>().toEqualTypeOf<
      "private" | "group" | "guild" | "thread"
    >();
    expectTypeOf<Actor["id"]>().toEqualTypeOf<string>();
    expectTypeOf<EventMetadata>().toEqualTypeOf<{ persist: boolean; triggerCandidate: boolean }>();
  });
});

describe("PlatformListener<T>", () => {
  it("binds translate output and renderContent input to the same T", () => {
    type L = PlatformListener<"message">;
    expectTypeOf<L["eventType"]>().toEqualTypeOf<"message">();
    expectTypeOf<Parameters<L["renderContent"]>[0]>().toEqualTypeOf<MessagePayload>();
    type Translated = Extract<Awaited<ReturnType<L["translate"]>>, { type: "event" }>;
    expectTypeOf<Translated["event"]>().toEqualTypeOf<PlatformEventOf<"message">>();
  });

  it("TranslateResult<T> carries the type-bound event", () => {
    expectTypeOf<TranslateResult<"message">>().toEqualTypeOf<
      { type: "event"; event: PlatformEventOf<"message"> } | { type: "pass" } | { type: "drop" }
    >();
  });

  it("GatewayEvent carries content alongside the event", () => {
    expectTypeOf<GatewayEvent["content"]>().toEqualTypeOf<UserContent>();
    expectTypeOf<GatewayEvent["event"]>().toEqualTypeOf<PlatformEvent>();
  });
});
