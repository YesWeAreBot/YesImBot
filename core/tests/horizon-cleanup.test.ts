import { describe, it, expect, beforeEach, vi } from "vitest";

import { EnvironmentManager } from "../src/services/horizon/environment";
import { EventManager } from "../src/services/horizon/manager";
import { TimelineStage } from "../src/services/horizon/types";
import { createMessageRecord } from "./fixtures/timeline-entries";

// ---- EventManager.deleteStale Tests ----

describe("EventManager.deleteStale", () => {
  let manager: EventManager;
  let mockExecute: ReturnType<typeof vi.fn>;
  let mockRemove: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockExecute = vi.fn().mockResolvedValue([]);
    mockRemove = vi.fn().mockResolvedValue(undefined);

    const mockCtx = {
      database: {
        select: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            execute: mockExecute,
          }),
        }),
        remove: mockRemove,
      },
      logger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      }),
    } as any;

    manager = new EventManager(mockCtx);
  });

  it("should remove all Deleted-stage entries for a channel key", async () => {
    const deletedEntries = [
      createMessageRecord({ index: 1, stage: TimelineStage.Deleted }),
      createMessageRecord({ index: 2, stage: TimelineStage.Deleted }),
    ];
    mockExecute.mockResolvedValue(deletedEntries);

    const count = await manager.deleteStale(
      { platform: "test-platform", channelId: "test-channel" },
      TimelineStage.Deleted,
    );

    expect(count).toBe(2);
    expect(mockRemove).toHaveBeenCalledWith("yesimbot.timeline", {
      platform: "test-platform",
      channelId: "test-channel",
      stage: TimelineStage.Deleted,
    });
  });

  it("should remove all Archived-stage entries for a channel key", async () => {
    const archivedEntries = [createMessageRecord({ index: 1, stage: TimelineStage.Archived })];
    mockExecute.mockResolvedValue(archivedEntries);

    const count = await manager.deleteStale(
      { platform: "test-platform", channelId: "test-channel" },
      TimelineStage.Archived,
    );

    expect(count).toBe(1);
    expect(mockRemove).toHaveBeenCalledWith("yesimbot.timeline", {
      platform: "test-platform",
      channelId: "test-channel",
      stage: TimelineStage.Archived,
    });
  });

  it("should return 0 and skip remove when no entries match", async () => {
    mockExecute.mockResolvedValue([]);

    const count = await manager.deleteStale(
      { platform: "test-platform", channelId: "test-channel" },
      TimelineStage.Deleted,
    );

    expect(count).toBe(0);
    expect(mockRemove).not.toHaveBeenCalled();
  });
});

// ---- EnvironmentManager.cleanup Tests ----

describe("EnvironmentManager.cleanup", () => {
  /**
   * Helper to create an EnvironmentManager with a mocked JsonDB.
   * We construct the manager, then replace the private `db` field
   * with a mock that returns controlled data.
   */
  function createManagerWithMockDb(mockData: Record<string, any>, cacheTtl: number) {
    const mockCommit = vi.fn();
    const mockUpdate = vi.fn().mockImplementation(function (this: any, fn: (data: any) => void) {
      fn(mockData);
      return { commit: mockCommit };
    });
    const mockDb = {
      getData: () => mockData,
      update: mockUpdate,
      commit: mockCommit,
      get: vi.fn(),
      set: vi.fn().mockReturnValue({ commit: vi.fn() }),
    };

    // Construct with a mock ctx that has baseDir. The constructor tries to
    // create a JsonDB on the filesystem, so we override the private `db` field.
    const mockCtx = { baseDir: "/tmp/test-cleanup-env" } as any;

    // We need to bypass the constructor's JsonDB creation.
    // Use Object.create to skip constructor, then manually set fields.
    const envManager = Object.create(EnvironmentManager.prototype) as EnvironmentManager;
    (envManager as any).db = mockDb;
    (envManager as any).cacheTtl = cacheTtl;

    return { envManager, mockCommit, mockUpdate };
  }

  it("should remove expired environments and return count", () => {
    const now = Date.now();
    const shortTtl = 1000; // 1 second TTL

    const mockData: Record<string, any> = {
      "test:ch1": {
        type: "group",
        id: "test:ch1",
        name: "Channel 1",
        platform: "test",
        channelId: "ch1",
        updatedAt: new Date(now - 5000).toISOString(), // 5s ago, expired
      },
      "test:ch2": {
        type: "group",
        id: "test:ch2",
        name: "Channel 2",
        platform: "test",
        channelId: "ch2",
        updatedAt: new Date(now - 500).toISOString(), // 0.5s ago, NOT expired
      },
      "test:ch3": {
        type: "private",
        id: "test:ch3",
        name: "Channel 3",
        platform: "test",
        channelId: "ch3",
        updatedAt: new Date(now - 3000).toISOString(), // 3s ago, expired
      },
    };

    const { envManager, mockCommit } = createManagerWithMockDb(mockData, shortTtl);

    const removed = envManager.cleanup();

    expect(removed).toBe(2); // ch1 and ch3 expired
    expect(mockCommit).toHaveBeenCalled();
  });

  it("should return 0 and not commit when nothing expired", () => {
    const now = Date.now();
    const longTtl = 60000; // 60 seconds TTL

    const freshData: Record<string, any> = {
      "test:ch1": {
        type: "group",
        id: "test:ch1",
        name: "Channel 1",
        platform: "test",
        channelId: "ch1",
        updatedAt: new Date(now - 1000).toISOString(), // 1s ago, NOT expired
      },
    };

    const { envManager, mockCommit } = createManagerWithMockDb(freshData, longTtl);

    const removed = envManager.cleanup();

    expect(removed).toBe(0);
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it("should handle empty environment store", () => {
    const emptyData: Record<string, any> = {};

    const { envManager, mockCommit } = createManagerWithMockDb(emptyData, 1000);

    const removed = envManager.cleanup();

    expect(removed).toBe(0);
    expect(mockCommit).not.toHaveBeenCalled();
  });
});
