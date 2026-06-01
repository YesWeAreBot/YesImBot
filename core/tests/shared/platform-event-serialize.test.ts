import { describe, expect, expectTypeOf, it } from "vitest";

import {
  isAthenaEventEntry,
  parsePlatformEvent,
  serializePlatformEvent,
  type AthenaEventEntry,
  type MessagePayload,
  type PlatformEventOf,
  type SerializedPlatformEvent,
  type UnknownPlatformEvent,
} from "../../src/shared/platform-event.js";

function makeMessageEvent(
  overrides: Partial<PlatformEventOf<"message">> = {},
): PlatformEventOf<"message"> {
  return {
    id: "evt-1",
    type: "message",
    timestamp: 1779181260000,
    source: { platform: "onebot", channelId: "g-1", sourceType: "group" },
    actor: { id: "u-1", name: "Alice" },
    visible: true,
    payload: { messageId: "m-1", content: "hi" },
    metadata: { persist: true, triggerCandidate: false },
    ...overrides,
  };
}

describe("serializePlatformEvent", () => {
  it("copies wire fields and stamps version", () => {
    const event = makeMessageEvent();
    const serialized = serializePlatformEvent(event);
    expect(serialized).toEqual({
      version: 1,
      id: "evt-1",
      type: "message",
      timestamp: 1779181260000,
      source: { platform: "onebot", channelId: "g-1", sourceType: "group" },
      actor: { id: "u-1", name: "Alice" },
      payload: { messageId: "m-1", content: "hi" },
    });
    expect(serialized).not.toHaveProperty("visible");
    expect(serialized).not.toHaveProperty("metadata");
  });

  it("includes target only when present", () => {
    const target = { id: "u-2", name: "Bob" };
    expect(serializePlatformEvent(makeMessageEvent({ target }))).toMatchObject({ target });
    expect(serializePlatformEvent(makeMessageEvent())).not.toHaveProperty("target");
  });

  it("type-level: serialize input rejects UnknownPlatformEvent", () => {
    expectTypeOf<
      Parameters<typeof serializePlatformEvent>[0]
    >().not.toEqualTypeOf<UnknownPlatformEvent>();
    expectTypeOf<Parameters<typeof serializePlatformEvent<"message">>[0]>().toEqualTypeOf<
      PlatformEventOf<"message">
    >();
    expectTypeOf<ReturnType<typeof serializePlatformEvent<"message">>>().toEqualTypeOf<
      SerializedPlatformEvent<"message">
    >();
  });
});

describe("parsePlatformEvent", () => {
  it("round-trips a message event with default visible/metadata", () => {
    const event = makeMessageEvent();
    const wire = JSON.parse(JSON.stringify(serializePlatformEvent(event)));
    const parsed = parsePlatformEvent(wire);
    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe("message");
    expect(parsed!.id).toBe(event.id);
    expect(parsed!.timestamp).toBe(event.timestamp);
    expect(parsed!.source).toEqual(event.source);
    expect(parsed!.actor).toEqual(event.actor);
    expect((parsed as PlatformEventOf<"message">).payload).toEqual(event.payload);
    expect(parsed!.visible).toBe(true);
    expect(parsed!.metadata).toEqual({ persist: true, triggerCandidate: false });
  });

  it.each([
    ["null", null],
    ["non-object", 42],
    [
      "wrong version",
      { version: 2, id: "x", type: "message", timestamp: 0, source: {}, actor: {}, payload: {} },
    ],
    [
      "missing type",
      { version: 1, id: "x", timestamp: 0, source: {}, actor: { id: "a" }, payload: {} },
    ],
    [
      "missing payload",
      { version: 1, id: "x", type: "message", timestamp: 0, source: {}, actor: { id: "a" } },
    ],
    [
      "missing actor",
      { version: 1, id: "x", type: "message", timestamp: 0, source: {}, payload: {} },
    ],
    [
      "missing source.platform",
      {
        version: 1,
        id: "x",
        type: "message",
        timestamp: 0,
        source: { channelId: "c", sourceType: "group" },
        actor: { id: "a" },
        payload: { messageId: "m", content: "hi" },
      },
    ],
    [
      "missing source.channelId",
      {
        version: 1,
        id: "x",
        type: "message",
        timestamp: 0,
        source: { platform: "p", sourceType: "group" },
        actor: { id: "a" },
        payload: { messageId: "m", content: "hi" },
      },
    ],
    [
      "missing source.sourceType",
      {
        version: 1,
        id: "x",
        type: "message",
        timestamp: 0,
        source: { platform: "p", channelId: "c" },
        actor: { id: "a" },
        payload: { messageId: "m", content: "hi" },
      },
    ],
    [
      "invalid source.sourceType",
      {
        version: 1,
        id: "x",
        type: "message",
        timestamp: 0,
        source: { platform: "p", channelId: "c", sourceType: "dm" },
        actor: { id: "a" },
        payload: { messageId: "m", content: "hi" },
      },
    ],
  ])("returns null for invalid input: %s", (_label, raw) => {
    expect(parsePlatformEvent(raw)).toBeNull();
  });

  it("returns UnknownPlatformEvent for non-message type", () => {
    const wire = {
      version: 1,
      id: "x",
      type: "message.recall",
      timestamp: 1,
      source: { platform: "p", channelId: "c", sourceType: "group" },
      actor: { id: "u" },
      payload: { something: true },
    };
    const parsed = parsePlatformEvent(wire);
    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe("message.recall");
    expect(parsed!.payload).toEqual({ something: true });
  });

  it("returns null for message type with invalid payload", () => {
    const wire = {
      version: 1,
      id: "x",
      type: "message",
      timestamp: 1,
      source: { platform: "p", channelId: "c", sourceType: "group" },
      actor: { id: "u" },
      payload: { messageId: "m" },
    };
    expect(parsePlatformEvent(wire)).toBeNull();
  });
});

describe("isAthenaEventEntry", () => {
  const base = { type: "custom_message", customType: "athena:event", content: [], details: {} };

  it("accepts well-formed entries", () => {
    expect(isAthenaEventEntry(base)).toBe(true);
  });

  it.each([
    ["null", null],
    ["wrong type", { ...base, type: "message" }],
    ["wrong customType", { ...base, customType: "other" }],
    ["missing details", { type: "custom_message", customType: "athena:event", content: [] }],
    ["missing content", { type: "custom_message", customType: "athena:event", details: {} }],
  ])("rejects %s", (_label, raw) => {
    expect(isAthenaEventEntry(raw as unknown)).toBe(false);
  });

  it("narrows to AthenaEventEntry", () => {
    const raw: unknown = base;
    if (isAthenaEventEntry(raw)) {
      expectTypeOf<typeof raw>().toMatchTypeOf<AthenaEventEntry>();
      expectTypeOf<typeof raw.customType>().toEqualTypeOf<"athena:event">();
    }
  });
});

type _AssertMessagePayload = MessagePayload;
