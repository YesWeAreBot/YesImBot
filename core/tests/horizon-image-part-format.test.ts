import { describe, expect, it } from "vitest";

import { MessageHandler, type BuildContextOptions } from "../src/services/horizon/handlers";
import { TimelineEventType, TimelinePriority, TimelineStage, type MessageRecord } from "../src/services/horizon/types";

describe("horizon image part format", () => {
  it("passes cached images to the model as raw base64 plus mediaType", async () => {
    const handler = new MessageHandler();
    const record: MessageRecord = {
      id: "msg-1",
      timestamp: new Date("2026-03-15T16:10:00Z"),
      platform: "test",
      channelId: "channel-1",
      type: TimelineEventType.Message,
      priority: TimelinePriority.Normal,
      stage: TimelineStage.Active,
      data: {
        messageId: "native-1",
        senderId: "user-1",
        senderName: "Alice",
        content: 'look <img id="img-001"/>',
      },
    };

    const options: BuildContextOptions = {
      channelKey: "test:channel-1",
      imageConfig: {
        imageMode: "native",
        maxImagesInContext: 3,
        imageLifecycleCount: 3,
      },
      parseElements: (text: string) => {
        const matches = [...text.matchAll(/<img\s+id="([^"]+)"\s*\/>/g)];
        return matches.map((match) => ({
          type: "img",
          attrs: { id: match[1] },
          toString: () => match[0],
        }));
      },
      shouldEmbedImage: () => true,
      getImageCache: async (id: string) =>
        id === "img-001"
          ? {
              base64: "aGVsbG8=",
              mediaType: "image/png",
              status: "ok",
            }
          : undefined,
    };

    const result = await handler.handle(record, options);

    expect(result).toHaveLength(1);
    expect(Array.isArray(result[0]?.content)).toBe(true);
    if (Array.isArray(result[0]?.content)) {
      const imagePart = result[0].content.find((part) => part.type === "image");
      expect(imagePart?.type).toBe("image");
      if (imagePart?.type === "image") {
        expect(imagePart.image).toBe("aGVsbG8=");
        expect(imagePart.mediaType).toBe("image/png");
        expect(String(imagePart.image)).not.toContain("data:image");
      }
    }
  });
});
