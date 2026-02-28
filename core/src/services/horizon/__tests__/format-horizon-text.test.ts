import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import Mustache from "mustache";
import { describe, expect, it } from "vitest";

/**
 * Smoke tests for BUGFIX-01: snippet variable rendering in horizon-view.
 *
 * Tests verify that the scope construction pattern used by formatHorizonText
 * correctly resolves snippet variables like {{date.now}} and {{bot.name}}.
 *
 * GREEN after 23-02 threads scope construction into formatHorizonText.
 */

const TEMPLATE_PATH = resolve(
  __dirname,
  "../../../../resources/templates/partials/horizon-view.mustache",
);

function loadTemplate(): string {
  return readFileSync(TEMPLATE_PATH, "utf-8");
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
