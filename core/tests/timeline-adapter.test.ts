import type { Context } from "koishi";
import { describe, expect, it, vi } from "vitest";

import { EventManager } from "../src/services/horizon/manager";
import { HorizonService } from "../src/services/horizon/service";
import type { HorizonView, ImageConfig } from "../src/services/horizon/types";
import {
  buildScenarioTimeline,
  getMarkedEvents,
  getMessageCount,
  getParticipants,
  getRecentTurns,
} from "../src/services/runtime/scenario-timeline";
import {
  createAgentActionRecord,
  createAgentResponseRecord,
  createHeartbeatRecord,
  createMessageRecord,
  createSummaryRecord,
} from "./fixtures/timeline-entries";

function flattenContent(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === "string") {
    return content;
  }
  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n");
}

describe("timeline adapter", () => {
  it("adapts ScenarioTimeline into conservative transcript semantics", async () => {
    const eventManager = new EventManager({
      logger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() })),
    } as unknown as Context);

    const entries = [
      createMessageRecord({
        index: 1,
        minutesOffset: 0,
        data: {
          senderId: "legacy-user",
          senderName: "Legacy",
          content: "before summary",
        },
      }),
      createSummaryRecord({
        index: 1,
        minutesOffset: 1,
        data: {
          content: "latest summary",
          coveredUntil: new Date("2026-03-05T10:01:00Z"),
        },
      }),
      createMessageRecord({
        index: 2,
        minutesOffset: 2,
        data: {
          senderId: "user-a",
          senderName: "Alice",
          content: "active question",
        },
      }),
      createHeartbeatRecord({
        index: 1,
        minutesOffset: 3,
      }),
      createAgentResponseRecord({
        index: 1,
        minutesOffset: 4,
        data: {
          rawText: "draft-only response",
        },
      }),
      createAgentActionRecord({
        index: 1,
        minutesOffset: 5,
        data: {
          actions: [{ name: "send_message", params: { content: "visible output" } }],
          toolResults: [
            {
              name: "send_message",
              success: true,
              status: "ok",
              result: { messageId: "sent-1", content: "visible output" },
            },
          ],
        },
      }),
    ];
    const timeline = buildScenarioTimeline(entries);
    const messageCount = getMessageCount(timeline);
    const participants = getParticipants(timeline);
    const markedEvents = getMarkedEvents(timeline);
    const recentTurns = getRecentTurns(timeline, 1);

    const messages = await eventManager.buildLoopMessages(timeline, {
      selfId: "bot-1",
      channelKey: "test:channel",
    });
    const transcript = messages.map((message) => flattenContent(message.content)).join("\n");

    expect(messages.some((message) => message.role === "assistant")).toBe(false);
    expect(transcript).toContain("active question");
    expect(transcript).toContain("send_message -> sent");
    expect(transcript).not.toContain("before summary");
    expect(transcript).not.toContain("draft-only response");
    expect(transcript).not.toContain("heartbeat");
    expect(messageCount).toBe(1);
    expect(participants.map((participant) => participant.id)).toEqual(["user-a"]);
    expect(markedEvents.some((event) => event.type === "tool-result")).toBe(true);
    expect(recentTurns).toHaveLength(1);
  });

  it("keeps environment/members/latest-summary as preamble and adapts transcript from scenario timeline", async () => {
    const loggerFactory = Object.assign(
      vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() })),
      { warn: vi.fn() },
    );
    const mockCtx = {
      baseDir: "/tmp/yesimbot-test",
      logger: loggerFactory,
      model: { extend: vi.fn() },
      command: vi.fn(() => ({ subcommand: vi.fn() })),
      on: vi.fn(),
      database: {},
      "yesimbot.prompt": {},
      "yesimbot.formatter": {},
      "yesimbot.image-cache": {
        get: vi.fn(async () => undefined),
      },
    };
    const service = new HorizonService(mockCtx as unknown as Context, {
      allowedChannels: [],
    });

    const history = [
      createMessageRecord({
        index: 7,
        minutesOffset: 0,
        data: {
          senderId: "old-user",
          senderName: "Old",
          content: "old transcript",
        },
      }),
      createSummaryRecord({
        index: 8,
        minutesOffset: 1,
        data: {
          content: "summary background",
          coveredUntil: new Date("2026-03-05T10:01:00Z"),
        },
      }),
      createMessageRecord({
        index: 9,
        minutesOffset: 2,
        data: {
          senderId: "user-1",
          senderName: "Alice",
          content: "new transcript",
        },
      }),
      createAgentResponseRecord({
        index: 2,
        minutesOffset: 3,
        data: {
          rawText: "draft internal response",
        },
      }),
      createAgentActionRecord({
        index: 2,
        minutesOffset: 4,
        data: {
          actions: [{ name: "send_message", params: { content: "hello" } }],
          toolResults: [{ name: "send_message", success: true, status: "ok" }],
        },
      }),
    ];

    const view: HorizonView = {
      self: { id: "bot-1", name: "Athena" },
      environment: {
        type: "guild",
        id: "channel-1",
        name: "Test Channel",
        platform: "discord",
        channelId: "channel-1",
      },
      entities: [
        { id: "user-1", type: "user", name: "Alice", userId: "user-1", username: "Alice" },
      ],
      history,
    };
    const timeline = buildScenarioTimeline(history);

    const messages = await service.formatHorizonText(
      view,
      undefined,
      { imageMode: "off", maxImagesInContext: 3, imageLifecycleCount: 3 },
      timeline,
    );
    const preamble = flattenContent(messages[0]?.content ?? "");
    const transcript = messages
      .slice(1)
      .map((message) => flattenContent(message.content))
      .join("\n");

    expect(preamble).toContain("<environment>");
    expect(preamble).toContain("<members>");
    expect(preamble).toContain("<summary>summary background</summary>");
    expect(transcript).toContain("new transcript");
    expect(transcript).toContain("send_message -> sent");
    expect(transcript).not.toContain("old transcript");
    expect(transcript).not.toContain("draft internal response");
  });

  it("keeps images embedded inside message content while adapting from scenario timeline", async () => {
    const eventManager = new EventManager({
      logger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() })),
    } as unknown as Context);

    const history = [
      createSummaryRecord({
        index: 20,
        minutesOffset: 1,
        data: {
          content: "summary boundary",
          coveredUntil: new Date("2026-03-05T10:01:00Z"),
        },
      }),
      createMessageRecord({
        index: 21,
        minutesOffset: 2,
        data: {
          senderId: "user-image",
          senderName: "ImageUser",
          content: 'message with <img id="img-001"/> in content',
        },
      }),
    ];
    const timeline = buildScenarioTimeline(history);
    const imageConfig: ImageConfig = {
      imageMode: "native",
      maxImagesInContext: 3,
      imageLifecycleCount: 3,
    };

    const messages = await eventManager.buildLoopMessages(timeline, {
      selfId: "bot-1",
      channelKey: "test:channel",
      imageConfig,
      parseElements: (text: string) => {
        const matches = [...text.matchAll(/<img\s+id="([^"]+)"\s*\/>/g)];
        return matches.map((match) => ({
          type: "img",
          attrs: { id: match[1] },
          toString: () => match[0],
        }));
      },
      getImageCache: async (id: string) =>
        id === "img-001"
          ? {
              base64: "aGVsbG8=",
              mediaType: "image/png",
              status: "ok",
            }
          : undefined,
    });

    expect(messages).toHaveLength(1);
    expect(Array.isArray(messages[0]?.content)).toBe(true);
    if (Array.isArray(messages[0]?.content)) {
      const textPart = messages[0].content.find((part) => part.type === "text");
      const imagePart = messages[0].content.find((part) => part.type === "image");
      expect(textPart?.type).toBe("text");
      if (textPart?.type === "text") {
        expect(textPart.text).toContain('<img id="img-001"/>');
      }
      expect(imagePart?.type).toBe("image");
      if (imagePart?.type === "image") {
        expect(imagePart.image).toBe("aGVsbG8=");
        expect(imagePart.mediaType).toBe("image/png");
      }
    }
  });
});
