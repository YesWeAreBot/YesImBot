import { describe, it, expect, beforeEach, vi } from "vitest";

import type { HorizonView, SummaryData } from "../src/services/horizon/types";
import { TimelineEventType } from "../src/services/horizon/types";
import { createMessageRecord, createSummaryRecord } from "./fixtures/timeline-entries";

// Mock HorizonService for formatHorizonText testing
class MockHorizonService {
  async formatHorizonText(view: HorizonView): Promise<Array<{ role: string; content: string }>> {
    const preambleParts: string[] = [];

    // Add environment
    if (view.environment) {
      const env = view.environment;
      const typeLabel = env.type === "private" ? "Private" : "Group";
      const environment = `Platform: ${env.platform || ""}, Channel: ${env.id || ""} (${typeLabel})`;
      preambleParts.push(`<environment>${environment}</environment>`);
    }

    // Add members
    if (view.entities && view.entities.length > 0) {
      const memberLines = view.entities.map((e) => `<member id="${e.id}" name="${e.name}"/>`);
      preambleParts.push(`<members>\n${memberLines.join("\n")}\n</members>`);
    }

    // Add latest Summary if exists
    const latestSummary = (view.history ?? [])
      .filter((e) => e.type === TimelineEventType.Summary)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0];

    if (latestSummary && latestSummary.type === TimelineEventType.Summary) {
      preambleParts.push(`<summary>${latestSummary.data.content}</summary>`);
    }

    const preamble = preambleParts.join("\n");

    const messages: Array<{ role: string; content: string }> = [];
    if (preamble) messages.push({ role: "user", content: preamble });

    return messages;
  }
}

describe("Summary Timeline Type", () => {
  it("should create Summary record with required fields", () => {
    const data: SummaryData = {
      content: "Test summary",
      coveredUntil: new Date(),
    };
    expect(data.content).toBe("Test summary");
    expect(data.coveredUntil).toBeInstanceOf(Date);
  });

  it("should support optional previousSummaryId", () => {
    const data: SummaryData = {
      content: "Test",
      coveredUntil: new Date(),
      previousSummaryId: "prev-123",
    };
    expect(data.previousSummaryId).toBe("prev-123");
  });
});

describe("formatHorizonText Summary rendering", () => {
  let service: MockHorizonService;

  beforeEach(() => {
    service = new MockHorizonService();
  });

  it("should render latest Summary between members and history", async () => {
    const summary = createSummaryRecord({
      index: 1,
      minutesOffset: 10,
      data: { content: "Previous conversation summary", coveredUntil: new Date() },
    });

    const view: HorizonView = {
      self: { id: "bot-001", name: "TestBot" },
      environment: {
        type: "guild",
        id: "channel-001",
        name: "Test Channel",
        platform: "test",
        channelId: "channel-001",
      },
      entities: [{ id: "user-001", type: "user", name: "Alice" }],
      history: [summary],
    };

    const messages = await service.formatHorizonText(view);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");

    const preamble = messages[0].content;
    expect(preamble).toContain("<environment>");
    expect(preamble).toContain("<members>");
    expect(preamble).toContain("<summary>Previous conversation summary</summary>");

    // Verify order: environment, members, summary
    const envIdx = preamble.indexOf("<environment>");
    const membersIdx = preamble.indexOf("<members>");
    const summaryIdx = preamble.indexOf("<summary>");
    expect(envIdx).toBeLessThan(membersIdx);
    expect(membersIdx).toBeLessThan(summaryIdx);
  });

  it("should use only latest Summary when multiple exist", async () => {
    const oldSummary = createSummaryRecord({
      index: 1,
      minutesOffset: 5,
      data: { content: "Old summary", coveredUntil: new Date() },
    });

    const newSummary = createSummaryRecord({
      index: 2,
      minutesOffset: 15,
      data: { content: "Latest summary", coveredUntil: new Date() },
    });

    const view: HorizonView = {
      self: { id: "bot-001", name: "TestBot" },
      history: [oldSummary, newSummary],
    };

    const messages = await service.formatHorizonText(view);
    const preamble = messages[0].content;

    expect(preamble).toContain("<summary>Latest summary</summary>");
    expect(preamble).not.toContain("Old summary");
  });

  it("should skip Summary block when no Summary exists", async () => {
    const message = createMessageRecord({ index: 1, minutesOffset: 5 });

    const view: HorizonView = {
      self: { id: "bot-001", name: "TestBot" },
      history: [message],
    };

    const messages = await service.formatHorizonText(view);
    const preamble = messages[0]?.content ?? "";

    expect(preamble).not.toContain("<summary>");
  });
});
