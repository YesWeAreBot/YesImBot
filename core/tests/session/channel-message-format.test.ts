import { describe, expect, it } from "vitest";

import {
  renderInboundChannelMessage,
  summarizeReplyContent,
} from "../../src/services/session/channel-message";

describe("channel message formatter", () => {
  it("exact structured header labels", () => {
    const rendered = renderInboundChannelMessage({
      timestamp: Date.UTC(2026, 2, 31, 12, 0, 0),
      platform: "discord",
      channelId: "general",
      userId: "u-1",
      username: "alice",
      nickname: "Ali",
      identity: "member",
      isDirect: false,
      atSelf: true,
      isReplyToBot: false,
      content: "hello world",
    });

    expect(rendered).toContain("[timestamp]");
    expect(rendered).toContain("[platform/channel]");
    expect(rendered).toContain("[sender]");
    expect(rendered).toContain("[context]");
  });

  it("falls back nickname and identity", () => {
    const rendered = renderInboundChannelMessage({
      timestamp: Date.UTC(2026, 2, 31, 12, 0, 0),
      platform: "discord",
      channelId: "general",
      userId: "u-1",
      username: "alice",
      isDirect: false,
      atSelf: false,
      isReplyToBot: false,
      content: "hello world",
    });

    expect(rendered).toContain("nickname=alice");
    expect(rendered).toContain("identity=member");
  });

  it("reply summary whitespace collapse", () => {
    const longContent = "line1\n\nline2\tline3 " + "x".repeat(120);
    const summary = summarizeReplyContent(longContent);

    expect(summary.includes("\n")).toBe(false);
    expect(summary.includes("\t")).toBe(false);
    expect(summary.endsWith("…")).toBe(true);
  });

  it("keeps body outside header after one blank line", () => {
    const rendered = renderInboundChannelMessage({
      timestamp: Date.UTC(2026, 2, 31, 12, 0, 0),
      platform: "discord",
      channelId: "general",
      userId: "u-1",
      username: "alice",
      isDirect: false,
      atSelf: false,
      isReplyToBot: true,
      replyTo: {
        username: "bot",
        nickname: "Athena",
        summary: "previous message",
      },
      content: "hello body",
    });

    expect(rendered).toContain("\n\nhello body");
  });
});
