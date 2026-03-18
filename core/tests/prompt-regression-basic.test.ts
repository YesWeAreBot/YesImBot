import { describe, expect, it } from "vitest";

import {
  CANONICAL_SECTION_ORDER,
  renderPromptSnapshot,
  writePromptTextSnapshot,
} from "./helpers/prompt-regression";

type BasicScenario = {
  id: "basic-group-chat" | "basic-mention-message" | "basic-direct-message" | "basic-empty-history";
  options: {
    triggerType: "mention" | "direct";
    isDirect: boolean;
    messages: string[];
  };
};

const EXPECTED_ORDER = ["identity", "policy", "memory", "situation"];

function assertCanonicalOrder(order: string[]): void {
  expect(order).toEqual(EXPECTED_ORDER);
  expect(order).toEqual(CANONICAL_SECTION_ORDER);
}

function assertSharedPromptShape(fullPrompt: string): void {
  expect(fullPrompt).toContain("<identity>");
  expect(fullPrompt).toContain("<policy>");
  expect(fullPrompt).toContain("<memory>");
  expect(fullPrompt).toContain("<situation>");
  expect(fullPrompt).toContain("<skills>");
  expect(fullPrompt).toContain("<tools>");
  expect(fullPrompt).toContain("## Tool Protocol");
  expect(fullPrompt).toContain("Tools/actions available this round:");
}

function assertBaselineMetadata(snapshot: Awaited<ReturnType<typeof renderPromptSnapshot>>): void {
  expect(snapshot.metadata.generatedAt).toBe("2026-03-15T10:00:00.000Z");
  expect(snapshot.metadata.stableSignature.length).toBeGreaterThan(10);
  expect(snapshot.metadata.loadedSkills).toEqual([]);
  expect(snapshot.metadata.allowedTools).toEqual([]);
}

describe("prompt regression basic", () => {
  it("helper harness renders full prompt snapshot", async () => {
    const snapshot = await renderPromptSnapshot({
      scenarioId: "helper-harness",
      triggerType: "mention",
      isDirect: false,
    });

    expect(snapshot).toHaveProperty("sections");
    expect(snapshot).toHaveProperty("fragments");
    expect(snapshot).toHaveProperty("metadata");
    expect(snapshot).toHaveProperty("fullPrompt");
    assertCanonicalOrder(snapshot.metadata.sectionOrder);
    assertSharedPromptShape(snapshot.fullPrompt);
    assertBaselineMetadata(snapshot);
    expect(snapshot.sections).toHaveLength(4);
    expect(snapshot.fragments.length).toBeGreaterThan(0);
    expect(snapshot.metadata.scenarioId).toBe("helper-harness");

    writePromptTextSnapshot("helper-harness", snapshot.fullPrompt);
  });

  const scenarios: BasicScenario[] = [
    {
      id: "basic-group-chat",
      options: { triggerType: "mention" as const, isDirect: false, messages: ["team sync update"] },
    },
    {
      id: "basic-mention-message",
      options: {
        triggerType: "mention" as const,
        isDirect: false,
        messages: ["@athena can you summarize this?"],
      },
    },
    {
      id: "basic-direct-message",
      options: { triggerType: "direct" as const, isDirect: true, messages: ["hello in dm"] },
    },
    {
      id: "basic-empty-history",
      options: { triggerType: "mention" as const, isDirect: false, messages: [] },
    },
  ];

  for (const scenario of scenarios) {
    it(`captures ${scenario.id}`, async () => {
      const snapshot = await renderPromptSnapshot({
        scenarioId: scenario.id,
        ...scenario.options,
      });

      assertCanonicalOrder(snapshot.metadata.sectionOrder);
      assertBaselineMetadata(snapshot);
      assertSharedPromptShape(snapshot.fullPrompt);

      const situationSection = snapshot.sections.find((section) => section.name === "situation");
      const memorySection = snapshot.sections.find((section) => section.name === "memory");
      const identitySection = snapshot.sections.find((section) => section.name === "identity");
      const policySection = snapshot.sections.find((section) => section.name === "policy");

      expect(identitySection?.content).toContain("You are Athena");
      expect(policySection?.content).toContain("Follow platform policy");
      expect(memorySection?.content).toContain("Recent memory");
      expect(situationSection?.content).toContain("<skills>");
      expect(situationSection?.content).toContain("<tools>");
      expect(situationSection?.content).toContain(`Scenario ${scenario.id}`);

      if (scenario.id === "basic-direct-message") {
        expect(snapshot.fullPrompt).toContain("trigger=direct");
      } else {
        expect(snapshot.fullPrompt).toContain("trigger=mention");
      }

      if (scenario.id === "basic-empty-history") {
        expect(memorySection?.content).toContain("Recent memory:");
      }

      if (scenario.id === "basic-group-chat") {
        expect(memorySection?.content).toContain("team sync update");
      }

      if (scenario.id === "basic-mention-message") {
        expect(memorySection?.content).toContain("@athena can you summarize this?");
      }

      writePromptTextSnapshot(scenario.id, snapshot.fullPrompt);
      expect(snapshot).toMatchSnapshot();
    });
  }
});
