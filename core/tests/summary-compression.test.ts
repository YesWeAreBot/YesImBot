import { Context } from "koishi";
import { describe, it, expect, beforeEach, vi } from "vitest";

import type { ChannelKey } from "../src/runtime/contracts";
import { SummaryCompressor } from "../src/services/horizon/compressor";
import { EventManager } from "../src/services/horizon/manager";
import { TimelineStage, TimelineEventType } from "../src/services/horizon/types";
import {
  createMessageRecord,
  createAgentResponseRecord,
  createSummaryRecord,
} from "./fixtures/timeline-entries";

describe("SummaryCompressor robustness", () => {
  let ctx: Context;
  let events: EventManager;
  let compressor: SummaryCompressor;
  let mockModelService: { call: ReturnType<typeof vi.fn> };
  let mockDatabase: {
    create: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    // Mock Context
    ctx = {
      logger: vi.fn(() => ({
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      })),
      database: {
        create: vi.fn(),
        select: vi.fn(() => ({
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          execute: vi.fn().mockResolvedValue([]),
        })),
        set: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as Context;

    mockDatabase = ctx.database;

    // Mock ModelService
    mockModelService = {
      call: vi.fn().mockResolvedValue({ text: "Generated summary content" }),
    };
    ctx["yesimbot.model"] = mockModelService;

    events = new EventManager(ctx);
    compressor = new SummaryCompressor(ctx, events, "openai:gpt-4o-mini");
  });

  it("deduplicates concurrent compress calls", async () => {
    const channelKey: ChannelKey = { platform: "test", channelId: "channel-001" };
    const entries = [
      createMessageRecord({ index: 1, minutesOffset: 0 }),
      createMessageRecord({ index: 2, minutesOffset: 1 }),
    ];

    // Trigger three concurrent compress calls
    const promise1 = compressor.compress(channelKey, entries);
    const promise2 = compressor.compress(channelKey, entries);
    const promise3 = compressor.compress(channelKey, entries);

    await Promise.all([promise1, promise2, promise3]);

    // Model should only be called once due to deduplication
    expect(mockModelService.call).toHaveBeenCalledTimes(1);
  });

  it("archives covered entries after successful compression", async () => {
    const channelKey: ChannelKey = { platform: "test", channelId: "channel-001" };
    const entries = [
      createMessageRecord({ index: 1, minutesOffset: 0 }),
      createAgentResponseRecord({ index: 1, minutesOffset: 1 }),
    ];

    await compressor.compress(channelKey, entries);

    // Verify database.set was called to archive entries
    expect(mockDatabase.set).toHaveBeenCalledWith(
      "yesimbot.timeline",
      expect.objectContaining({
        platform: "test",
        channelId: "channel-001",
        stage: TimelineStage.Active,
        type: { $ne: TimelineEventType.Summary },
      }),
      { stage: TimelineStage.Archived },
    );
  });

  it("handles model call failures gracefully", async () => {
    const channelKey: ChannelKey = { platform: "test", channelId: "channel-001" };
    const entries = [createMessageRecord({ index: 1, minutesOffset: 0 })];

    // Mock model failure
    mockModelService.call.mockRejectedValueOnce(new Error("Model API error"));

    // Should not throw
    await expect(compressor.compress(channelKey, entries)).resolves.toBeUndefined();

    // Should not create summary record on failure
    expect(mockDatabase.create).not.toHaveBeenCalled();

    // Should not archive entries on failure
    expect(mockDatabase.set).not.toHaveBeenCalled();
  });

  it("handles null model results gracefully", async () => {
    const channelKey: ChannelKey = { platform: "test", channelId: "channel-001" };
    const entries = [createMessageRecord({ index: 1, minutesOffset: 0 })];

    // Mock null result
    mockModelService.call.mockResolvedValueOnce(null);

    // Should not throw
    await expect(compressor.compress(channelKey, entries)).resolves.toBeUndefined();

    // Should not create summary record
    expect(mockDatabase.create).not.toHaveBeenCalled();

    // Should not archive entries
    expect(mockDatabase.set).not.toHaveBeenCalled();
  });

  it("does not archive Summary entries", async () => {
    const channelKey: ChannelKey = { platform: "test", channelId: "channel-001" };
    const entries = [
      createMessageRecord({ index: 1, minutesOffset: 0 }),
      createSummaryRecord({ index: 1, minutesOffset: 1 }),
    ];

    await compressor.compress(channelKey, entries);

    // Verify the archive query excludes Summary type
    const setCall = mockDatabase.set.mock.calls[0];
    expect(setCall[1]).toMatchObject({
      type: { $ne: TimelineEventType.Summary },
    });
  });

  it("allows sequential compress calls after first completes", async () => {
    const channelKey: ChannelKey = { platform: "test", channelId: "channel-001" };
    const entries = [createMessageRecord({ index: 1, minutesOffset: 0 })];

    // First call
    await compressor.compress(channelKey, entries);
    expect(mockModelService.call).toHaveBeenCalledTimes(1);

    // Second call after first completes
    await compressor.compress(channelKey, entries);
    expect(mockModelService.call).toHaveBeenCalledTimes(2);
  });

  it("handles different channels independently", async () => {
    const channel1: ChannelKey = { platform: "test", channelId: "channel-001" };
    const channel2: ChannelKey = { platform: "test", channelId: "channel-002" };
    const entries = [createMessageRecord({ index: 1, minutesOffset: 0 })];

    // Concurrent calls to different channels should both execute
    await Promise.all([
      compressor.compress(channel1, entries),
      compressor.compress(channel2, entries),
    ]);

    expect(mockModelService.call).toHaveBeenCalledTimes(2);
  });
});
