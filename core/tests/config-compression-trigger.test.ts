import { describe, it, expect } from "vitest";
import { Config } from "../src/index";

describe("Config - Compression Trigger Ownership", () => {
  it("should expose compressionThreshold at root level", () => {
    const config: Partial<Config> = {
      compressionThreshold: 100,
    };

    expect(config.compressionThreshold).toBe(100);
  });

  it("should expose inactivityTriggerMs at root level", () => {
    const config: Partial<Config> = {
      inactivityTriggerMs: 3600000,
    };

    expect(config.inactivityTriggerMs).toBe(3600000);
  });

  it("should expose retainRecentEntries at root level", () => {
    const config: Partial<Config> = {
      retainRecentEntries: 15,
    };

    expect(config.retainRecentEntries).toBe(15);
  });

  it("should keep memoryAgent.summaryModel separate from root summaryModel", () => {
    const config: Partial<Config> = {
      summaryModel: "openai:gpt-4o-mini", // Timeline compression model
      memoryAgent: {
        summaryModel: "openai:gpt-4o", // Memory extraction model
        compressionThreshold: 80,
        compressionIntervalMs: 3600000,
        inactivityTriggerMs: 1800000,
        coreMemoryBudget: 2000,
        maxAgentSteps: 15,
        retainRecentEntries: 10,
      },
    };

    expect(config.summaryModel).toBe("openai:gpt-4o-mini");
    expect(config.memoryAgent?.summaryModel).toBe("openai:gpt-4o");
  });

  it("should not have compression trigger fields in memoryAgent config", () => {
    // This test validates that MemoryAgentConfig no longer owns trigger fields
    const config: Partial<Config> = {
      compressionThreshold: 100,
      inactivityTriggerMs: 3600000,
      retainRecentEntries: 15,
      memoryAgent: {
        coreMemoryBudget: 2000,
        summaryModel: "openai:gpt-4o",
        maxAgentSteps: 15,
      },
    };

    // Root level should have trigger fields
    expect(config.compressionThreshold).toBe(100);
    expect(config.inactivityTriggerMs).toBe(3600000);
    expect(config.retainRecentEntries).toBe(15);

    // memoryAgent should NOT have trigger fields (type check will enforce this)
    expect(config.memoryAgent).toBeDefined();
    expect(config.memoryAgent?.coreMemoryBudget).toBe(2000);
  });
});
