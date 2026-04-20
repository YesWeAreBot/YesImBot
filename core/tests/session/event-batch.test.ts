import { describe, expect, it } from "vitest";

import { AgentSession } from "../../src/services/session/agent-session";
import { materializeTimeline } from "../../src/services/session/materialize";
import { SessionManager } from "../../src/services/session/session-manager";
import type {
  ActivationReason,
  AthenaEvent,
  ChannelRawPayload,
  TimelineRecord,
} from "../../src/services/session/types";

type SessionWithEventIngress = AgentSession & {
  appendAthenaEvent: <TRaw extends ChannelRawPayload | undefined = undefined>(
    event: AthenaEvent<TRaw>,
  ) => string;
  appendActivationResult: (record: {
    id: string;
    timestamp: number;
    stage: "ingress" | "runtime" | "persisted";
    batchId: string;
    activated: boolean;
    reasons: ActivationReason[];
  }) => string;
};

function createSession(): SessionWithEventIngress {
  return new AgentSession(SessionManager.inMemory("discord:channel-1")) as SessionWithEventIngress;
}

function createMixedBatchEvents(): AthenaEvent[] {
  return [
    {
      kind: "message",
      id: "evt-message-1",
      timestamp: 1_710_000_000_000,
      platform: "discord",
      channelId: "channel-1",
      messageId: "msg-1",
      content: "hello from batch",
      sender: {
        userId: "user-1",
        username: "alice",
      },
      isDirect: false,
      atSelf: true,
      isReplyToBot: false,
    },
    {
      kind: "channel_event",
      id: "evt-channel-1",
      timestamp: 1_710_000_000_001,
      platform: "discord",
      channelId: "channel-1",
      eventId: "join-1",
      eventType: "member_joined",
      sourceUserId: "user-2",
    },
    {
      kind: "internal_signal",
      id: "evt-signal-1",
      timestamp: 1_710_000_000_002,
      platform: "discord",
      channelId: "channel-1",
      signalType: "follow_up_review",
      source: "scheduler",
      summary: "wake follow-up review",
    },
  ];
}

function createReasons(code: ActivationReason["code"]): ActivationReason[] {
  return [{ source: code === "at_self" ? "policy" : "event", code }];
}

describe("event batch durable truth", () => {
  it("persists mixed AthenaEvent families as athena_event timeline records instead of legacy channel record kinds", () => {
    const session = createSession();

    for (const event of createMixedBatchEvents()) {
      session.appendAthenaEvent(event);
    }

    const timeline = session.getTimeline() as TimelineRecord[];

    expect(timeline).toHaveLength(3);
    expect(timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "athena_event",
          event: expect.objectContaining({ kind: "message", id: "evt-message-1" }),
        }),
        expect.objectContaining({
          kind: "athena_event",
          event: expect.objectContaining({ kind: "channel_event", id: "evt-channel-1" }),
        }),
        expect.objectContaining({
          kind: "athena_event",
          event: expect.objectContaining({ kind: "internal_signal", id: "evt-signal-1" }),
        }),
      ]),
    );
    expect(timeline).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "channel_message" }),
        expect.objectContaining({ kind: "channel_event" }),
      ]),
    );
  });

  it("persists record-only activation outcomes as one hidden activation_result system notice", () => {
    const session = createSession();

    session.appendActivationResult({
      id: "activation-record-only-1",
      timestamp: 1_710_000_000_010,
      stage: "ingress",
      batchId: "batch-record-only",
      activated: false,
      reasons: createReasons("channel_event"),
    });

    expect(session.getTimeline()).toEqual([
      expect.objectContaining({
        kind: "system_notice",
        subType: "activation_result",
        materializationKey: "activation_result",
        visibility: "hidden",
        materialization: "hidden",
        data: {
          batchId: "batch-record-only",
          activated: false,
          reasons: createReasons("channel_event"),
        },
      }),
    ]);
  });

  it("keeps activation_result hidden from default projection while still materializing visible and internal Athena events by policy", () => {
    const session = createSession();

    for (const event of createMixedBatchEvents()) {
      session.appendAthenaEvent(event);
    }
    session.appendActivationResult({
      id: "activation-activated-1",
      timestamp: 1_710_000_000_020,
      stage: "ingress",
      batchId: "batch-activated",
      activated: true,
      reasons: createReasons("at_self"),
    });

    const defaultProjection = materializeTimeline([...session.getTimeline()]);
    const internalProjection = materializeTimeline([...session.getTimeline()], {
      includeInternal: true,
    });

    expect(defaultProjection).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "user", content: expect.stringContaining("hello from batch") }),
        expect.objectContaining({
          role: "system",
          content: expect.stringContaining("member_joined"),
        }),
      ]),
    );
    expect(defaultProjection).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ content: expect.stringContaining("activation_result") }),
        expect.objectContaining({ content: expect.stringContaining("batch-activated") }),
        expect.objectContaining({ content: expect.stringContaining("follow_up_review") }),
      ]),
    );

    expect(internalProjection).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ content: expect.stringContaining("follow_up_review") }),
      ]),
    );
    expect(internalProjection).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ content: expect.stringContaining("activation_result") }),
      ]),
    );
  });
});
