import { describe, expect, it } from "vitest";

import {
  Activation,
  type ActivationResult,
  type AthenaEvent,
  type ChannelScopedAthenaEvent,
  type EventBatch,
} from "../../src/services/session/messages";

function acceptEvent(event: AthenaEvent): AthenaEvent {
  return event;
}

describe("Phase 11 activation contracts", () => {
  it("accepts explicit AthenaEvent families and rejects generic opaque payload shells", () => {
    const messageEvent = {
      kind: "message",
      id: "evt-msg-1",
      timestamp: 1_710_000_000_000,
      platform: "discord",
      channelId: "channel-1",
      messageId: "msg-1",
      content: "hello",
      sender: {
        userId: "user-1",
        username: "alice",
      },
      isDirect: true,
      atSelf: false,
      isReplyToBot: false,
    } satisfies AthenaEvent;

    const channelEvent = {
      kind: "channel_event",
      id: "evt-channel-1",
      timestamp: 1_710_000_000_001,
      platform: "discord",
      channelId: "channel-1",
      eventId: "event-1",
      eventType: "member_joined",
    } satisfies AthenaEvent;

    const platformNotice = {
      kind: "platform_notice",
      id: "evt-notice-1",
      timestamp: 1_710_000_000_002,
      platform: "discord",
      channelId: "channel-1",
      noticeType: "rate_limited",
      summary: "platform slowed down",
    } satisfies AthenaEvent;

    const internalSignal = {
      kind: "internal_signal",
      id: "evt-signal-1",
      timestamp: 1_710_000_000_003,
      platform: "discord",
      channelId: "channel-1",
      signalType: "follow_up_review",
      source: "scheduler",
      summary: "check pending follow up",
    } satisfies AthenaEvent;

    // @ts-expect-error Phase 11 forbids generic opaque payload-shell Athena events.
    acceptEvent({
      kind: "opaque_payload",
      id: "evt-opaque-1",
      timestamp: 1_710_000_000_099,
      payload: { anything: true },
    });

    expect(
      [messageEvent, channelEvent, platformNotice, internalSignal].map((event) => event.kind),
    ).toEqual(["message", "channel_event", "platform_notice", "internal_signal"]);

    const channelScopedSignal = {
      kind: "internal_signal",
      id: "evt-signal-scoped-1",
      timestamp: 1_710_000_000_004,
      platform: "discord",
      channelId: "channel-1",
      signalType: "follow_up_review",
      source: "scheduler",
    } satisfies ChannelScopedAthenaEvent;

    expect(channelScopedSignal.kind).toBe("internal_signal");
  });

  it("returns a structured activation result instead of a bare boolean", () => {
    const directMessageBatch = {
      batchId: "batch-direct",
      channelKey: "discord:channel-1",
      events: [
        {
          kind: "message",
          id: "evt-msg-1",
          timestamp: 1_710_000_000_000,
          platform: "discord",
          channelId: "channel-1",
          messageId: "msg-1",
          content: "hello",
          sender: {
            userId: "user-1",
            username: "alice",
          },
          isDirect: true,
          atSelf: false,
          isReplyToBot: false,
        },
      ],
    } satisfies EventBatch;

    const result = Activation.evaluate(directMessageBatch);
    const structuredResult: ActivationResult = result;

    expect(structuredResult).toMatchObject({
      batchId: "batch-direct",
      activated: true,
    });
    expect(Array.isArray(structuredResult.reasons)).toBe(true);
    expect(structuredResult).not.toBe(true);
    expect(structuredResult).not.toBe(false);
  });

  it("keeps direct-message, gray-zone, and mixed internal signals as policy ingredients inside the result", () => {
    const recordOnlyBatch = {
      batchId: "batch-gray-zone",
      channelKey: "discord:channel-1",
      events: [
        {
          kind: "message",
          id: "evt-msg-gray",
          timestamp: 1_710_000_000_010,
          platform: "discord",
          channelId: "channel-1",
          messageId: "msg-gray",
          content: "just chatting",
          sender: {
            userId: "user-2",
            username: "bob",
          },
          isDirect: false,
          atSelf: false,
          isReplyToBot: false,
        },
      ],
    } satisfies EventBatch;

    const mixedBatch = {
      batchId: "batch-mixed",
      channelKey: "discord:channel-1",
      events: [
        {
          kind: "channel_event",
          id: "evt-channel-2",
          timestamp: 1_710_000_000_020,
          platform: "discord",
          channelId: "channel-1",
          eventId: "event-2",
          eventType: "reaction_added",
        },
        {
          kind: "internal_signal",
          id: "evt-signal-2",
          timestamp: 1_710_000_000_021,
          platform: "discord",
          channelId: "channel-1",
          signalType: "follow_up_review",
          source: "scheduler",
          summary: "follow-up review requested",
        },
      ],
    } satisfies EventBatch;

    const recordOnlyResult = Activation.evaluate(recordOnlyBatch);
    const mixedResult = Activation.evaluate(mixedBatch);

    expect(recordOnlyResult).toMatchObject({
      batchId: "batch-gray-zone",
      activated: false,
    });
    expect(recordOnlyResult.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "policy",
          code: "no_trigger",
        }),
      ]),
    );

    expect(mixedResult).toMatchObject({
      batchId: "batch-mixed",
      activated: true,
    });
    expect(mixedResult.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "event",
          code: "internal_signal",
        }),
      ]),
    );
    expect(mixedResult.reasons).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          seam: "willingness",
        }),
      ]),
    );
  });
});
