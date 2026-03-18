import { Context } from "koishi";
import { describe, it, expect, beforeEach, vi } from "vitest";

import { SummaryCompressor } from "../src/services/horizon/compressor";
import { HorizonService } from "../src/services/horizon/service";

// Mock SummaryCompressor to verify constructor parameters
vi.mock("../src/services/horizon/compressor", () => {
  return {
    SummaryCompressor: vi.fn().mockImplementation(() => ({
      maybeCompress: vi.fn(),
    })),
  };
});

describe("HorizonService - Compression Trigger Wiring", () => {
  let mockCtx: Record<string, unknown>;
  let MockedCompressor: typeof SummaryCompressor;

  beforeEach(() => {
    vi.clearAllMocks();
    MockedCompressor = SummaryCompressor;

    mockCtx = {
      logger: vi.fn(() => ({
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
      })),
      model: {
        extend: vi.fn(),
      },
      command: vi.fn(() => ({
        subcommand: vi.fn(),
      })),
      baseDir: "/tmp/test",
      on: vi.fn(),
      database: {},
      "yesimbot.prompt": {},
      "yesimbot.formatter": {},
      "yesimbot.image-cache": {},
    };
  }) as unknown as Context;

  it("should pass compressionThreshold to SummaryCompressor", () => {
    const config = {
      allowedChannels: [],
      compressionThreshold: 120,
      inactivityTriggerMs: 3600000,
      retainRecentEntries: 15,
      summaryModel: "openai:gpt-4o-mini",
    };

    new HorizonService(mockCtx as unknown as Context, config);

    expect(MockedCompressor).toHaveBeenCalledWith(
      mockCtx,
      expect.anything(), // EventManager
      "openai:gpt-4o-mini",
      expect.objectContaining({
        compressionThreshold: 120,
      }),
    );
  });

  it("should pass inactivityTriggerMs to SummaryCompressor", () => {
    const config = {
      allowedChannels: [],
      compressionThreshold: 100,
      inactivityTriggerMs: 7200000,
      retainRecentEntries: 10,
      summaryModel: "openai:gpt-4o",
    };

    new HorizonService(mockCtx as unknown as Context, config);

    expect(MockedCompressor).toHaveBeenCalledWith(
      mockCtx,
      expect.anything(),
      "openai:gpt-4o",
      expect.objectContaining({
        inactivityTriggerMs: 7200000,
      }),
    );
  });

  it("should pass retainRecentEntries to SummaryCompressor", () => {
    const config = {
      allowedChannels: [],
      compressionThreshold: 100,
      inactivityTriggerMs: 3600000,
      retainRecentEntries: 20,
      summaryModel: "openai:gpt-4o-mini",
    };

    new HorizonService(mockCtx as unknown as Context, config);

    expect(MockedCompressor).toHaveBeenCalledWith(
      mockCtx,
      expect.anything(),
      "openai:gpt-4o-mini",
      expect.objectContaining({
        retainRecentEntries: 20,
      }),
    );
  });

  it("should pass all three trigger fields together", () => {
    const config = {
      allowedChannels: [],
      compressionThreshold: 150,
      inactivityTriggerMs: 5400000,
      retainRecentEntries: 25,
      summaryModel: "openai:gpt-4o",
    };

    new HorizonService(mockCtx as unknown as Context, config);

    expect(MockedCompressor).toHaveBeenCalledWith(mockCtx, expect.anything(), "openai:gpt-4o", {
      compressionThreshold: 150,
      inactivityTriggerMs: 5400000,
      retainRecentEntries: 25,
    });
  });
});
