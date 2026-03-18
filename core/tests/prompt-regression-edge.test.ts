import { describe, expect, it } from "vitest";

import {
  CANONICAL_SECTION_ORDER,
  buildRoundContextFixture,
  renderPromptSnapshot,
  writePromptTextSnapshot,
} from "./helpers/prompt-regression";

type EdgeScenario = {
  id: "edge-long-history-memory" | "edge-multi-image-budget" | "edge-compressed-timeline";
  options: {
    longHistory?: boolean;
    imageMessages?: boolean;
    compressedTimeline?: boolean;
  };
};

const EXPECTED_ORDER = ["identity", "policy", "memory", "situation"];

function assertCanonicalOrder(order: string[]): void {
  expect(order).toEqual(EXPECTED_ORDER);
  expect(order).toEqual(CANONICAL_SECTION_ORDER);
}

function assertSnapshotMetadata(
  snapshot: Awaited<ReturnType<typeof renderPromptSnapshot>>,
  scenarioId: string,
): void {
  expect(snapshot.metadata.scenarioId).toBe(scenarioId);
  expect(snapshot.metadata.generatedAt).toBe("2026-03-15T10:00:00.000Z");
  expect(snapshot.metadata.stableSignature.length).toBeGreaterThan(10);
  expect(snapshot.metadata.sectionOrder).toEqual(EXPECTED_ORDER);
  expect(snapshot.metadata.loadedSkills).toEqual([]);
  expect(snapshot.metadata.allowedTools).toEqual([]);
}

function assertCapabilityBlocks(situationContent: string): void {
  expect(situationContent).toContain("<skills>");
  expect(situationContent).toContain("</skills>");
  expect(situationContent).toContain("<tools>");
  expect(situationContent).toContain("</tools>");
}

function assertPromptEnvelope(fullPrompt: string): void {
  expect(fullPrompt).toContain("<identity>");
  expect(fullPrompt).toContain("<policy>");
  expect(fullPrompt).toContain("<memory>");
  expect(fullPrompt).toContain("<situation>");
}

describe("prompt regression edge", () => {
  const scenarios: EdgeScenario[] = [
    {
      id: "edge-long-history-memory",
      options: { longHistory: true },
    },
    {
      id: "edge-multi-image-budget",
      options: { imageMessages: true },
    },
    {
      id: "edge-compressed-timeline",
      options: { compressedTimeline: true },
    },
  ];

  for (const scenario of scenarios) {
    it(`captures ${scenario.id}`, async () => {
      const fixture = buildRoundContextFixture(scenario.options);
      expect(fixture.scenario.raw.timeline.turns[0]?.messages.length ?? 0).toBeGreaterThan(0);

      const snapshot = await renderPromptSnapshot({
        scenarioId: scenario.id,
        ...scenario.options,
      });

      assertCanonicalOrder(snapshot.metadata.sectionOrder);
      assertSnapshotMetadata(snapshot, scenario.id);

      expect(snapshot.fullPrompt.length).toBeGreaterThan(0);
      assertPromptEnvelope(snapshot.fullPrompt);

      const situationSection = snapshot.sections.find((section) => section.name === "situation");
      const memorySection = snapshot.sections.find((section) => section.name === "memory");
      const situationContent = situationSection?.content ?? "";
      const memoryContent = memorySection?.content ?? "";

      assertCapabilityBlocks(situationContent);

      if (scenario.id === "edge-long-history-memory") {
        expect(memoryContent).toContain("Long history entry:");
      }

      if (scenario.id === "edge-multi-image-budget") {
        expect(memoryContent).toContain("[image] uploaded chart screenshot");
      }

      if (scenario.id === "edge-compressed-timeline") {
        expect(fixture.scenario.raw.timeline.latestSummary?.id).toBe("summary-compressed-0001");
        expect(snapshot.fullPrompt).toContain("Scenario edge-compressed-timeline");
      }

      writePromptTextSnapshot(scenario.id, snapshot.fullPrompt);
      expect(snapshot).toMatchSnapshot();
    });
  }
});
