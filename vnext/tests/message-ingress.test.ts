import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildAgentMessage,
  formatChannelPreamble,
  formatDirectMessage,
  formatGroupMessage,
  formatTimeOnly,
} from "../src/services/session/format";
import { judgeWillingness } from "../src/services/session/willingness";

describe("message ingress formatter", () => {
  it("formats group messages as HH:MM + sender + plain content", () => {
    const timestamp = new Date(2024, 2, 22, 23, 18).getTime();
    const result = formatGroupMessage({
      username: "Alice",
      content: "hello <img src='x'/>",
      timestamp,
      messageId: "m1",
    });

    expect(result).toBe("23:18 Alice: hello <img src='x'/>");
  });

  it("includes reply context when quoted content is provided", () => {
    const timestamp = new Date(2024, 2, 22, 23, 18).getTime();
    const result = formatGroupMessage({
      username: "Bob",
      content: "I agree",
      timestamp,
      messageId: "m2",
      quotedContent: "Let's ship it tomorrow",
    });

    expect(result).toContain('[reply to: "Let\'s ship it tomorrow"]');
    expect(result).toContain("23:18 Bob:");
  });

  it("formats direct message without timestamp or sender metadata", () => {
    const result = formatDirectMessage({ content: "hi there", messageId: "m2" });

    expect(result).toBe("hi there");
  });

  it("formats channel preamble with date and participants", () => {
    const preamble = formatChannelPreamble(new Date(2026, 2, 23), ["Alice", "Bob"]);

    expect(preamble).toBe("<现在是2026-03-23，你正在和Alice、Bob讨论>");
  });

  it("formats timestamp as HH:MM", () => {
    const timestamp = new Date(2024, 2, 22, 7, 5).getTime();
    expect(formatTimeOnly(timestamp)).toBe("07:05");
  });

  it("builds agent message with text part only", () => {
    const formatted = "23:18 Alice: hello";

    const agentMessage = buildAgentMessage(formatted, 1711153080000);

    expect(agentMessage).toEqual({
      role: "user",
      content: [{ type: "text", text: formatted }],
      timestamp: 1711153080000,
    });
  });
});

describe("willingness judge", () => {
  it("returns shouldRespond=true for direct message", () => {
    const result = judgeWillingness({
      isDirect: true,
      atSelf: false,
      isReplyToBot: false,
      content: "hello",
      triggerKeywords: ["athena"],
      selfId: "bot-1",
      senderId: "user-1",
    });

    expect(result).toEqual({ shouldRespond: true, reason: "direct_message" });
  });

  it("returns shouldRespond=true for atSelf", () => {
    const result = judgeWillingness({
      isDirect: false,
      atSelf: true,
      isReplyToBot: false,
      content: "hello",
      triggerKeywords: ["athena"],
      selfId: "bot-1",
      senderId: "user-1",
    });

    expect(result).toEqual({ shouldRespond: true, reason: "at_self" });
  });

  it("returns shouldRespond=true for keyword match", () => {
    const result = judgeWillingness({
      isDirect: false,
      atSelf: false,
      isReplyToBot: false,
      content: "Hey Athena, can you help?",
      triggerKeywords: ["athena"],
      selfId: "bot-1",
      senderId: "user-1",
    });

    expect(result).toEqual({ shouldRespond: true, reason: "keyword_match" });
  });

  it("returns shouldRespond=false for reply to bot without atSelf", () => {
    const result = judgeWillingness({
      isDirect: false,
      atSelf: false,
      isReplyToBot: true,
      content: "reply only",
      triggerKeywords: ["athena"],
      selfId: "bot-1",
      senderId: "user-1",
    });

    expect(result).toEqual({ shouldRespond: false, reason: "reply_without_at" });
  });

  it("returns shouldRespond=false for no trigger", () => {
    const result = judgeWillingness({
      isDirect: false,
      atSelf: false,
      isReplyToBot: false,
      content: "just talking",
      triggerKeywords: ["athena"],
      selfId: "bot-1",
      senderId: "user-1",
    });

    expect(result).toEqual({ shouldRespond: false, reason: "no_trigger" });
  });
});
