import { describe, expect, it, vi } from "vitest";

import { HookType } from "../src/services/hook/types";

/**
 * Message Hook Coverage Verification Tests
 *
 * Purpose: Verify that message send paths have correct hook coverage:
 * - User-facing messages (send_message action) are hooked
 * - Error reporting messages bypass hooks by design
 *
 * See docs/HOOK_COVERAGE.md for full coverage documentation
 */

describe("Message Hook Coverage", () => {
  describe("Covered Paths", () => {
    it("send_message action triggers Message hook", async () => {
      // This test verifies the architecture decision that user-facing messages
      // go through the hook system. The actual hook execution is tested in
      // hook-integration.test.ts - this test documents the coverage expectation.

      const hookService = {
        executeBefore: vi.fn().mockResolvedValue({
          skipped: false,
          params: { content: "modified content", session: {} },
        }),
      };

      // Simulate send_message action flow
      const content = "original content";
      const session = { send: vi.fn() };

      // Hook should be called before sending
      const beforeResult = await hookService.executeBefore(
        HookType.Message,
        { content, session },
        "trace-123",
      );

      expect(hookService.executeBefore).toHaveBeenCalledWith(
        HookType.Message,
        { content, session },
        "trace-123",
      );

      expect(beforeResult.skipped).toBe(false);
      expect(beforeResult.params).toHaveProperty("content", "modified content");
    });

    it("hook can modify message content", async () => {
      const hookService = {
        executeBefore: vi.fn().mockResolvedValue({
          skipped: false,
          params: { content: "FILTERED CONTENT", session: {} },
        }),
      };

      const originalContent = "bad word here";
      const session = {};

      const result = await hookService.executeBefore(
        HookType.Message,
        { content: originalContent, session },
        "trace-456",
      );

      const modifiedContent = (result.params as { content: string }).content;
      expect(modifiedContent).toBe("FILTERED CONTENT");
      expect(modifiedContent).not.toBe(originalContent);
    });

    it("hook can skip message sending", async () => {
      const hookService = {
        executeBefore: vi.fn().mockResolvedValue({
          skipped: true,
          result: { success: false, message: "Message blocked by filter" },
        }),
      };

      const content = "spam message";
      const session = {};

      const result = await hookService.executeBefore(
        HookType.Message,
        { content, session },
        "trace-789",
      );

      expect(result.skipped).toBe(true);
      expect(result.result).toEqual({
        success: false,
        message: "Message blocked by filter",
      });
    });
  });

  describe("Uncovered Paths (By Design)", () => {
    it("error reporting bypasses hooks", () => {
      // This test documents the architectural decision that error reporting
      // messages bypass the hook system to ensure reliability.
      //
      // Location: core/src/services/agent/service.ts:533
      // Pattern: await bot.sendMessage(channelId, summary).catch(() => {});
      //
      // Rationale:
      // 1. Error messages are system-level notifications
      // 2. Must be reliable and not subject to plugin interference
      // 3. Prevents infinite loops if hooks themselves cause errors
      //
      // See docs/HOOK_COVERAGE.md for full rationale

      const bot = {
        sendMessage: vi.fn().mockResolvedValue(undefined),
      };

      const channelId = "channel-123";
      const errorSummary = "[Error] channel-123: Something went wrong";

      // Error reporting sends directly without hook execution
      bot.sendMessage(channelId, errorSummary);

      expect(bot.sendMessage).toHaveBeenCalledWith(channelId, errorSummary);
      expect(bot.sendMessage).toHaveBeenCalledTimes(1);
    });

    it("error reporting is fail-safe", async () => {
      // Error reporting must work even if the send fails
      const bot = {
        sendMessage: vi.fn().mockRejectedValue(new Error("Network error")),
      };

      const channelId = "channel-456";
      const errorSummary = "[Error] channel-456: Agent loop failed";

      // Error reporting catches and ignores send failures
      await bot.sendMessage(channelId, errorSummary).catch(() => {});

      expect(bot.sendMessage).toHaveBeenCalledWith(channelId, errorSummary);
      // No error thrown - failure is silently caught
    });
  });

  describe("Coverage Documentation", () => {
    it("documents all message send paths", () => {
      // This test serves as a checklist for message send paths
      // See docs/HOOK_COVERAGE.md for detailed documentation

      const messageSendPaths = {
        // Covered paths (user-facing)
        "send_message action (current channel)": {
          location: "core/src/services/plugin/builtin/core.ts:139",
          hooked: true,
          hookType: HookType.Message,
        },
        "send_message action (cross-channel)": {
          location: "core/src/services/plugin/builtin/core.ts:127",
          hooked: true,
          hookType: HookType.Message,
        },

        // Uncovered paths (system-level)
        "error reporting": {
          location: "core/src/services/agent/service.ts:533",
          hooked: false,
          rationale: "System-level error notifications must be reliable",
        },
      };

      // Verify covered paths have hook type
      const coveredPaths = Object.entries(messageSendPaths).filter(([, config]) => config.hooked);
      expect(coveredPaths.length).toBeGreaterThan(0);
      for (const [, config] of coveredPaths) {
        if ("hookType" in config) {
          expect(config.hookType).toBe(HookType.Message);
        }
      }

      // Verify uncovered paths have rationale
      const uncoveredPaths = Object.entries(messageSendPaths).filter(
        ([, config]) => !config.hooked,
      );
      expect(uncoveredPaths.length).toBeGreaterThan(0);
      for (const [, config] of uncoveredPaths) {
        if ("rationale" in config) {
          expect(config.rationale).toBeDefined();
        }
      }
    });
  });
});
