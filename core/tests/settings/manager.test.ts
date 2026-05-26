import { describe, expect, it } from "vitest";

import {
  DEFAULT_RUNTIME_SETTINGS,
  InMemorySettingsStorage,
  RuntimeSettingsManager,
} from "../../src/internal/runtime/settings.js";

describe("RuntimeSettingsManager", () => {
  it("returns defaults when no seed, global, or local exist", () => {
    const manager = new RuntimeSettingsManager({
      globalPath: "/tmp/athena/settings.json",
      storage: new InMemorySettingsStorage(),
    });

    const s = manager.settings;
    expect(s.contextWindow).toBe(DEFAULT_RUNTIME_SETTINGS.contextWindow);
    expect(s.compaction.enabled).toBe(true);
    expect(s.compaction.reserveTokens).toBe(16384);
    expect(s.delivery.enabled).toBe(true);
    expect(s.delivery.segmentation.targetCountWeights.one).toBe(0.45);
  });

  it("merges seed into defaults (seed overrides defaults)", () => {
    const manager = new RuntimeSettingsManager({
      globalPath: "/tmp/athena/settings.json",
      storage: new InMemorySettingsStorage(),
      seed: {
        contextWindow: 64000,
        compaction: { reserveTokens: 4096 },
      },
    });

    const s = manager.settings;
    expect(s.contextWindow).toBe(64000);
    expect(s.compaction.reserveTokens).toBe(4096);
    // Unseeded fields retain defaults
    expect(s.compaction.enabled).toBe(true);
    expect(s.compaction.keepRecentTokens).toBe(20000);
    expect(s.delivery.enabled).toBe(true);
  });

  it("global file overrides seed and defaults", () => {
    const storage = new InMemorySettingsStorage();
    // Pre-populate global settings file
    storage.save("/tmp/athena/settings.json", {
      contextWindow: 96000,
      compaction: { keepRecentTokens: 15000 },
    });

    const manager = new RuntimeSettingsManager({
      globalPath: "/tmp/athena/settings.json",
      storage,
      seed: {
        contextWindow: 64000,
        compaction: { reserveTokens: 4096 },
      },
    });

    const s = manager.settings;
    // Global overrides seed
    expect(s.contextWindow).toBe(96000);
    // Global overrides seed/default for keepRecentTokens
    expect(s.compaction.keepRecentTokens).toBe(15000);
    // Seed fills in reserveTokens (not in global file)
    expect(s.compaction.reserveTokens).toBe(4096);
  });

  it("local overrides global, seed, and defaults", () => {
    const storage = new InMemorySettingsStorage();
    storage.save("/tmp/athena/settings.json", {
      contextWindow: 96000,
      steeringMode: "one-at-a-time",
    });
    storage.save("/tmp/athena/sessions/onebot/123/settings.json", {
      contextWindow: 32000,
    });

    const manager = new RuntimeSettingsManager({
      globalPath: "/tmp/athena/settings.json",
      localPath: "/tmp/athena/sessions/onebot/123/settings.json",
      storage,
      seed: { contextWindow: 64000 },
    });

    const s = manager.settings;
    // Local wins
    expect(s.contextWindow).toBe(32000);
    // Global wins over seed/default
    expect(s.steeringMode).toBe("one-at-a-time");
    // Default for unoverridden fields
    expect(s.followUpMode).toBe("all");
  });

  it("setters persist to the specified scope", async () => {
    const storage = new InMemorySettingsStorage();
    const manager = new RuntimeSettingsManager({
      globalPath: "/tmp/athena/settings.json",
      localPath: "/tmp/athena/sessions/onebot/123/settings.json",
      storage,
    });

    manager.setContextWindow(64000, "global");
    manager.setSteeringMode("one-at-a-time", "local");
    await manager.flush();

    const globalData = storage.load("/tmp/athena/settings.json");
    expect(globalData.contextWindow).toBe(64000);

    const localData = storage.load("/tmp/athena/sessions/onebot/123/settings.json");
    expect(localData.steeringMode).toBe("one-at-a-time");
  });

  it("seed does not overwrite existing global fields", () => {
    const storage = new InMemorySettingsStorage();
    storage.save("/tmp/athena/settings.json", {
      contextWindow: 96000,
    });

    const manager = new RuntimeSettingsManager({
      globalPath: "/tmp/athena/settings.json",
      storage,
      seed: {
        contextWindow: 64000,
        compaction: { reserveTokens: 4096 },
      },
    });

    // Global 96000 wins over seed 64000
    expect(manager.settings.contextWindow).toBe(96000);
    // Seed fills in what global doesn't have
    expect(manager.settings.compaction.reserveTokens).toBe(4096);
  });

  it("delivery settings merge correctly across layers", () => {
    const storage = new InMemorySettingsStorage();
    storage.save("/tmp/athena/settings.json", {
      delivery: {
        timing: { initialDelayMinMs: 500 },
      },
    });

    const manager = new RuntimeSettingsManager({
      globalPath: "/tmp/athena/settings.json",
      storage,
    });

    const d = manager.settings.delivery;
    // Global override
    expect(d.timing.initialDelayMinMs).toBe(500);
    // Defaults for untouched fields
    expect(d.enabled).toBe(true);
    expect(d.segmentation.targetCountWeights.one).toBe(0.45);
    expect(d.timing.maxDelayMs).toBe(6500);
  });
});
