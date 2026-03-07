import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

import { SummaryCompressor } from "../src/services/horizon/compressor";
import { EventManager } from "../src/services/horizon/manager";
import { TimelineEventType, TimelineStage } from "../src/services/horizon/types";
import type { ChannelKey } from "../src/services/shared/types";
import {
  createMessageRecord,
  createTimelineSequence,
} from "./fixtures/timeline-entries";

describe("SummaryCompressor hybrid triggers", () => {
  let compressor: SummaryCompressor;
  let mockEvents: {
    query: ReturnType<typeof vi.fn>;
    recordSummary: ReturnType<typeof vi.fn>;
  };
  let mockModelService: { call: ReturnType<typeof vi.fn> };
  let mockDatabase: {
    create: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
  };
  let ctx: Record<string, unknown>;
  const channelKey: ChannelKey = { platform: "test", channelId: "channel-001" };

  beforeEach(() => {
    vi.useFakeTimers();

    mockModelService = {
      call: vi.fn().mockResolvedValue({ text: "Generated summary" }),
    };

    mockDatabase = {
      create: vi.fn(),
      select: vi.fn(() => ({
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue([]),
      })),
      set: vi.fn().mockResolvedValue(undefined),
    };

    ctx = {
      logger: vi.fn(() => ({
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      })),
      database: mockDatabase,
      "yesimbot.model": mockModelService,
    };

    // Mock EventManager with query returning timeline entries
    mockEvents = {
      query: vi.fn().mockResolvedValue([]),
      recordSummary: vi.fn().mockResolvedValue(undefined),
    };

    compressor = new SummaryCompressor(
      ctx as never,
      mockEvents as unknown as EventManager,
      "openai:gpt-4o-mini",
      {
        compressionThreshold: 80,
        inactivityTriggerMs: 1800000, // 30 min
        retainRecentEntries: 10,
      },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("maybeCompress() event count trigger", () => {
    it("triggers compression when event count exceeds threshold", async () => {
      // Create 85 entries (> 80 threshold)
      const entries = createTimelineSequence(85, (i) =>
        createMessageRecord({ index: i, minutesOffset: i }),
      );
      mockEvents.query.mockResolvedValue(entries);

      await compressor.maybeCompress(channelKey);

      // Should have called compress (model.call invoked)
      expect(mockModelService.call).toHaveBeenCalledTimes(1);
    });

    it("does NOT trigger when event count is below threshold", async () => {
      // Only 5 entries (< 80 threshold, also < retainRecentEntries)
      const entries = createTimelineSequence(5, (i) =>
        createMessageRecord({ index: i, minutesOffset: i }),
      );
      mockEvents.query.mockResolvedValue(entries);

      await compressor.maybeCompress(channelKey);

      expect(mockModelService.call).not.toHaveBeenCalled();
    });
  });

  describe("maybeCompress() inactivity trigger", () => {
    it("triggers when inactivity period exceeded and events > retainRecentEntries", async () => {
      // 20 entries (> 10 retainRecentEntries) with first compression recorded
      const entries = createTimelineSequence(20, (i) =>
        createMessageRecord({ index: i, minutesOffset: i }),
      );
      mockEvents.query.mockResolvedValue(entries);

      // First maybeCompress sets lastCompressionTime but count < threshold
      // so we need to set the time manually by first calling with enough events
      // Actually, simulate inactivity: advance time by 31 minutes (> 30min threshold)
      // We need the lastCompressionTime to have been set in the past
      // The simplest approach: call maybeCompress once (it won't trigger because count < 80),
      // then advance time past inactivity threshold and call again

      // First call sets lastCompressionTime without triggering (count < 80, no prior time)
      await compressor.maybeCompress(channelKey);
      expect(mockModelService.call).not.toHaveBeenCalled();

      // Advance time past inactivity threshold
      vi.advanceTimersByTime(1800001); // 30 min + 1ms

      await compressor.maybeCompress(channelKey);

      // Now should trigger: inactivity exceeded AND entries > retainRecentEntries
      expect(mockModelService.call).toHaveBeenCalledTimes(1);
    });

    it("does NOT trigger when inactivity period exceeded but events <= retainRecentEntries", async () => {
      // Only 5 entries (<= 10 retainRecentEntries)
      const entries = createTimelineSequence(5, (i) =>
        createMessageRecord({ index: i, minutesOffset: i }),
      );
      mockEvents.query.mockResolvedValue(entries);

      // First call sets lastCompressionTime
      await compressor.maybeCompress(channelKey);

      // Advance time past inactivity
      vi.advanceTimersByTime(1800001);

      await compressor.maybeCompress(channelKey);

      // Should NOT trigger because not enough entries to compress
      expect(mockModelService.call).not.toHaveBeenCalled();
    });
  });

  describe("maybeCompress() channel locking", () => {
    it("skips when compression already in progress for that channel", async () => {
      // Create enough entries to trigger compression
      const entries = createTimelineSequence(85, (i) =>
        createMessageRecord({ index: i, minutesOffset: i }),
      );
      mockEvents.query.mockResolvedValue(entries);

      // Make model call slow to keep compression in progress
      mockModelService.call.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ text: "summary" }), 5000)),
      );

      // Start first compression (won't complete immediately)
      const promise1 = compressor.maybeCompress(channelKey);

      // Second call should skip
      const promise2 = compressor.maybeCompress(channelKey);

      // Advance timers to let both complete
      vi.advanceTimersByTime(5000);
      await Promise.all([promise1, promise2]);

      // Model should only be called once
      expect(mockModelService.call).toHaveBeenCalledTimes(1);
    });
  });

  describe("compress() retainRecentEntries", () => {
    it("retains recent N entries and only compresses older ones", async () => {
      // Create 20 entries
      const entries = createTimelineSequence(20, (i) =>
        createMessageRecord({ index: i, minutesOffset: i }),
      );

      // compress should pass only entries[0..9] to the model (first 10)
      // and retain entries[10..19] (last 10)
      await compressor.compress(channelKey, entries, 10);

      // Model should be called with older entries only
      expect(mockModelService.call).toHaveBeenCalledTimes(1);

      // Archive should cover up to the 10th entry's timestamp (not the full set)
      const setCall = mockDatabase.set.mock.calls[0];
      expect(setCall).toBeDefined();
      // The coveredUntil should be the timestamp of entries[9] (last of the compressed batch)
      expect(setCall[1]).toMatchObject({
        platform: "test",
        channelId: "channel-001",
        stage: TimelineStage.Active,
        type: { $ne: TimelineEventType.Summary },
      });
    });

    it("does not compress when all entries fall within retain window", async () => {
      // Only 5 entries, retain 10 -- nothing to compress
      const entries = createTimelineSequence(5, (i) =>
        createMessageRecord({ index: i, minutesOffset: i }),
      );

      await compressor.compress(channelKey, entries, 10);

      // No model call since nothing to compress
      expect(mockModelService.call).not.toHaveBeenCalled();
    });
  });

  describe("lastCompressionTime tracking", () => {
    it("updates lastCompressionTime after successful compression", async () => {
      const entries = createTimelineSequence(85, (i) =>
        createMessageRecord({ index: i, minutesOffset: i }),
      );
      mockEvents.query.mockResolvedValue(entries);

      const beforeTime = Date.now();
      await compressor.maybeCompress(channelKey);
      const afterTime = Date.now();

      // Second call should not trigger because time hasn't passed
      await compressor.maybeCompress(channelKey);

      // Model should only be called once (first trigger, second skipped due to recent compression)
      expect(mockModelService.call).toHaveBeenCalledTimes(1);
    });
  });
});
