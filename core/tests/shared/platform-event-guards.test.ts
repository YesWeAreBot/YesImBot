import { describe, expect, it } from "vitest";

import {
  isAthenaEventEntry,
  isPlatformEventOf,
  type PlatformEvent,
  type UnknownPlatformEvent,
} from "../../src/shared/platform-event.js";

function makeMessage(): PlatformEvent {
  return {
    id: "evt-1",
    type: "message",
    timestamp: 0,
    source: { platform: "p", channelId: "c", sourceType: "group" },
    actor: { id: "u" },
    visible: true,
    payload: { messageId: "m", content: "x" },
    metadata: { persist: true, triggerCandidate: false },
  };
}

function makeUnknown(): UnknownPlatformEvent {
  return {
    id: "evt-2",
    type: "message.recall",
    timestamp: 0,
    source: { platform: "p", channelId: "c", sourceType: "group" },
    actor: { id: "u" },
    visible: true,
    payload: {},
    metadata: { persist: true, triggerCandidate: false },
  };
}

describe("isPlatformEventOf", () => {
  it("returns true only for matching type", () => {
    expect(isPlatformEventOf(makeMessage(), "message")).toBe(true);
    expect(isPlatformEventOf(makeUnknown(), "message")).toBe(false);
  });
});

describe("isAthenaEventEntry", () => {
  it("rejects null / non-object / arrays", () => {
    expect(isAthenaEventEntry(null)).toBe(false);
    expect(isAthenaEventEntry(42)).toBe(false);
    expect(isAthenaEventEntry([])).toBe(false);
  });
});
