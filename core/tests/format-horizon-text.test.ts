import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import Mustache from "mustache";
import { describe, expect, it } from "vitest";

const TEMPLATE_PATH = resolve(__dirname, "../resources/templates/partials/horizon-view.mustache");

const HISTORY_ITEM_TEMPLATE_PATH = resolve(
  __dirname,
  "../resources/templates/partials/history-item.mustache",
);

function loadTemplate(): string {
  return readFileSync(TEMPLATE_PATH, "utf-8");
}

function loadHistoryItemTemplate(): string {
  return readFileSync(HISTORY_ITEM_TEMPLATE_PATH, "utf-8");
}

/**
 * Builds the FIXED scope matching formatHorizonText's new implementation.
 * Includes nested date, bot, sender, channel objects for dot-path access.
 */
function buildFixedScope(overrides?: {
  botName?: string;
  botId?: string;
  senderName?: string;
  senderId?: string;
  channelName?: string;
  channelPlatform?: string;
}) {
  const fmt = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  return {
    date: { now: fmt.format(new Date()) },
    bot: {
      name: overrides?.botName || "{{bot.name}}",
      id: overrides?.botId || "{{bot.id}}",
    },
    sender: {
      name: overrides?.senderName || "{{sender.name}}",
      id: overrides?.senderId || "{{sender.id}}",
    },
    channel: {
      name: overrides?.channelName || "{{channel.name}}",
      platform: overrides?.channelPlatform || "{{channel.platform}}",
    },
    environment: "",
    activeMembers: "",
    hasHistory: false,
    history: [],
    hasTrigger: false,
    trigger: [],
  };
}

describe("formatHorizonText snippet rendering", () => {
  const template = loadTemplate();

  it("{{date.now}} renders non-empty", () => {
    const scope = buildFixedScope();
    const rendered = Mustache.render(template, scope).trim();

    // date.now should resolve to an actual date string (zh-CN format)
    expect(rendered).not.toContain("现在是 。");
    expect(rendered).toMatch(/现在是 .+。/);
  });

  it("{{bot.name}} resolves via scope when present in template", () => {
    const snippetTemplate = "Bot: {{bot.name}}, ID: {{bot.id}}";
    const scope = buildFixedScope({ botName: "TestBot", botId: "bot-1" });
    const rendered = Mustache.render(snippetTemplate, scope);

    expect(rendered).not.toBe("Bot: , ID: ");
    expect(rendered).toContain("TestBot");
    expect(rendered).toContain("bot-1");
  });

  it("missing sender variables preserve tag text", () => {
    const snippetTemplate = "From: {{sender.name}}";

    // Scope with fallback value (the fix pattern — no percept available)
    const scopeWithFallback = buildFixedScope();
    const rendered = Mustache.render(snippetTemplate, scopeWithFallback);

    // The fallback preserves the tag text literally
    expect(rendered).toContain("{{sender.name}}");
  });

  it("sender variables resolve when percept provides them", () => {
    const snippetTemplate = "From: {{sender.name}} ({{sender.id}})";
    const scope = buildFixedScope({ senderName: "Alice", senderId: "user-42" });
    const rendered = Mustache.render(snippetTemplate, scope);

    expect(rendered).toBe("From: Alice (user-42)");
  });

  it("channel variables resolve from environment", () => {
    const snippetTemplate = "Channel: {{channel.name}} on {{channel.platform}}";
    const scope = buildFixedScope({
      channelName: "general",
      channelPlatform: "discord",
    });
    const rendered = Mustache.render(snippetTemplate, scope);

    expect(rendered).toBe("Channel: general on discord");
  });

  it("full template renders with all snippet variables populated", () => {
    const scope = buildFixedScope({ botName: "Athena", botId: "bot-1" });
    const rendered = Mustache.render(template, scope).trim();

    // date.now should be present (non-empty after "现在是")
    expect(rendered).toMatch(/现在是 \d{4}年/);
    // Should not contain empty "现在是 。"
    expect(rendered).not.toContain("现在是 。");
  });
});

describe("history-item partial rendering", () => {
  const historyItemTpl = loadHistoryItemTemplate();
  const horizonViewTpl = loadTemplate();

  it("renders message observation with inline sender format", () => {
    const messageItem = {
      is_message: true,
      is_action: false,
      is_error: false,
      id: 1,
      time: "28:13:32",
      senderLine: "Alice(user-123)",
      replyLine: undefined,
      content: "Hello world",
    };

    const rendered = Mustache.render(historyItemTpl, messageItem);

    expect(rendered).toContain('<msg id="1" time="28:13:32">');
    expect(rendered).toContain("Alice(user-123)");
    expect(rendered).toContain("Hello world");
    expect(rendered).not.toContain("[回复:");
  });

  it("renders message with reply inline before content", () => {
    const messageItem = {
      is_message: true,
      is_action: false,
      is_error: false,
      id: 2,
      time: "28:13:33",
      senderLine: "Bob(user-456)",
      replyLine: "[回复: 1]",
      content: "I agree",
    };

    const rendered = Mustache.render(historyItemTpl, messageItem);

    expect(rendered).toContain('<msg id="2" time="28:13:33">');
    expect(rendered).toContain("Bob(user-456)");
    expect(rendered).toContain("[回复: 1]");
    expect(rendered).toContain("I agree");
  });

  it("renders action observation with <action> tag (not <bot-action>)", () => {
    const actionItem = {
      is_message: false,
      is_action: true,
      is_error: false,
      actionContent: "send_message -> sent",
    };

    const rendered = Mustache.render(historyItemTpl, actionItem);

    expect(rendered).toContain("<action>send_message -> sent</action>");
    expect(rendered).not.toContain("<bot-action>");
    expect(rendered).not.toContain("round=");
  });

  it("renders error observation with <error> tag (not <bot-error>)", () => {
    const errorItem = {
      is_message: false,
      is_action: false,
      is_error: true,
      errorContent: "API rate limit exceeded",
    };

    const rendered = Mustache.render(historyItemTpl, errorItem);

    expect(rendered).toContain("<error>API rate limit exceeded</error>");
    expect(rendered).not.toContain("<bot-error>");
    expect(rendered).not.toContain("round=");
  });

  it("renders history items through partial in horizon-view template", () => {
    const historyItem = {
      is_message: true,
      is_action: false,
      is_error: false,
      id: 3,
      time: "28:13:34",
      senderLine: "Charlie(user-789)",
      replyLine: undefined,
      content: "Test message",
    };

    const scope = buildFixedScope();
    scope.hasHistory = true;
    (scope.history as unknown[]) = [historyItem];

    const partials = {
      "history-item": historyItemTpl,
    };

    const rendered = Mustache.render(horizonViewTpl, scope, partials);

    // History section should contain rendered message
    expect(rendered).toContain('<msg id="3" time="28:13:34">');
    expect(rendered).toContain("Charlie(user-789)");
    expect(rendered).toContain("Test message");
    // Should not contain raw object toString
    expect(rendered).not.toContain("[object Object]");
  });

  it("renders trigger items through partial (not {{{.}}})", () => {
    const triggerItem = {
      is_message: true,
      is_action: false,
      is_error: false,
      id: 4,
      time: "28:13:35",
      senderLine: "David(user-999)",
      replyLine: undefined,
      content: "New message",
    };

    const scope = buildFixedScope();
    scope.hasTrigger = true;
    (scope.trigger as unknown[]) = [triggerItem];

    const partials = {
      "history-item": historyItemTpl,
    };

    const rendered = Mustache.render(horizonViewTpl, scope, partials);

    // Trigger section should contain rendered message
    expect(rendered).toContain("<trigger>");
    expect(rendered).toContain('<msg id="4" time="28:13:35">');
    expect(rendered).toContain("David(user-999)");
    expect(rendered).toContain("New message");
    // Should not contain raw object toString
    expect(rendered).not.toContain("[object Object]");
    // Should not contain raw {{{.}}} interpolation
    expect(rendered).not.toMatch(/\{\{\{\.?\}\}\}/);
  });
});
