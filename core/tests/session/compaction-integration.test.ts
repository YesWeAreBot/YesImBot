import type { LanguageModel } from "ai";
import { generateText } from "ai";
import { describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({
  generateText: vi.fn(async () => ({ text: "generated summary" })),
}));

import { AgentSession } from "../../src/services/session/agent-session";
import { compact, prepareCompaction } from "../../src/services/session/compaction";
import { SessionManager } from "../../src/services/session/session-manager";

describe("compaction integration", () => {
  it("compacts current session-entry history and appends a compaction sidecar", async () => {
    const sessionManager = SessionManager.inMemory("discord:channel-1");
    sessionManager.appendAthenaMessage({
      type: "user.message",
      timestamp: new Date(1_710_000_000_000).toISOString(),
      data: {
        messageId: "msg-1",
        senderId: "user-1",
        senderName: "alice",
        content: "old question",
      },
    });
    sessionManager.appendAssistantMessage({
      role: "assistant",
      content: [{ type: "text", text: "old answer" }],
    });
    sessionManager.appendRuntimeStateInfo("follow_up_review", undefined, {
      content: "helper-only",
    });
    sessionManager.appendAthenaMessage({
      type: "user.message",
      timestamp: new Date(1_710_000_000_001).toISOString(),
      data: {
        messageId: "msg-2",
        senderId: "user-2",
        senderName: "bob",
        content: "x".repeat(600),
      },
    });

    const messageEntries = sessionManager.getEntries().filter((entry) => entry.type === "message");
    const preparation = prepareCompaction(messageEntries, {
      enabled: true,
      reserveTokens: 16_384,
      keepRecentTokens: 30,
    });

    expect(preparation).toBeDefined();
    const result = await compact(preparation!, {} as LanguageModel);
    expect(generateText).toHaveBeenCalledTimes(1);
    sessionManager.appendCompaction(result.summary, result.firstKeptEntryId, result.tokensBefore);

    const session = new AgentSession(sessionManager);
    const modelMessages = session.getModelMessages();

    expect(modelMessages[0]).toEqual({
      role: "user",
      content: "[Context Summary]\ngenerated summary",
    });
    expect(sessionManager.getEntries().some((entry) => entry.type === "compaction")).toBe(true);
    expect(
      modelMessages.some((message) => {
        return typeof message.content === "string" && message.content.includes("helper-only");
      }),
    ).toBe(false);
  });
});
