import { describe, expect, it } from "vitest";

import {
  CANONICAL_SECTION_ORDER,
  renderPromptSnapshot,
  writePromptTextSnapshot,
} from "./helpers/prompt-regression";

type ToolScenario = {
  id: "tool-static-vs-dynamic-split" | "tool-no-available-tools" | "tool-skill-enabled-hidden-tool";
  options: {
    toolMode?: "default" | "none";
    allowedTools?: string[];
  };
};

const EXPECTED_ORDER = ["identity", "policy", "memory", "situation"];

function assertCanonicalOrder(order: string[]): void {
  expect(order).toEqual(EXPECTED_ORDER);
  expect(order).toEqual(CANONICAL_SECTION_ORDER);
}

function assertMetadata(
  snapshot: Awaited<ReturnType<typeof renderPromptSnapshot>>,
  expectedScenario: string,
  expectedAllowedTools: string[],
): void {
  expect(snapshot.metadata.scenarioId).toBe(expectedScenario);
  expect(snapshot.metadata.generatedAt).toBe("2026-03-15T10:00:00.000Z");
  expect(snapshot.metadata.loadedSkills).toEqual([]);
  expect(snapshot.metadata.allowedTools).toEqual(expectedAllowedTools);
  expect(snapshot.metadata.stableSignature.length).toBeGreaterThan(10);
}

function assertStaticDynamicSplit(policyContent: string, situationContent: string): void {
  expect(policyContent).toContain("## Tool Protocol");
  expect(policyContent).toContain("Tools retrieve information or compute results.");
  expect(policyContent).not.toContain("Available tools/actions this round");
  expect(policyContent).not.toContain("Tools/actions available this round:");

  expect(situationContent).toContain("<tools>");
  expect(situationContent).toContain("</tools>");
  expect(situationContent).not.toContain("## Tool Protocol");
}

function getLineContaining(content: string, needle: string): string {
  const line = content.split("\n").find((entry) => entry.includes(needle));
  expect(line).toBeDefined();
  return line ?? "";
}

function assertDefaultToolVisible(situationContent: string): void {
  expect(situationContent).toContain("Tools/actions available this round:");
  const sendMessageLine = getLineContaining(situationContent, "- send_message (action):");
  expect(sendMessageLine).toContain("Send a message to current channel");
  expect(situationContent).toContain("Parameters:");
}

function assertNoToolMessage(situationContent: string): void {
  expect(situationContent).toContain("No tools/actions are available this round.");
  expect(situationContent).not.toContain("Tools/actions available this round:");
  expect(situationContent).not.toContain("- send_message (action):");
  expect(situationContent).not.toContain("- search_web (tool):");
}

function assertHiddenToolAppearsWhenAllowed(situationContent: string): void {
  expect(situationContent).toContain("Tools/actions available this round:");
  expect(situationContent).toContain("- send_message (action):");
  const hiddenToolLine = getLineContaining(situationContent, "- search_web (tool):");
  expect(hiddenToolLine).toContain("Search web for factual lookups");
}

function assertPromptEnvelope(fullPrompt: string): void {
  expect(fullPrompt).toContain("<identity>");
  expect(fullPrompt).toContain("<policy>");
  expect(fullPrompt).toContain("<memory>");
  expect(fullPrompt).toContain("<situation>");
  expect(fullPrompt).toContain("<skills>");
  expect(fullPrompt).toContain("<tools>");
}

describe("prompt regression tool", () => {
  const scenarios: ToolScenario[] = [
    { id: "tool-static-vs-dynamic-split", options: {} },
    { id: "tool-no-available-tools", options: { toolMode: "none" as const } },
    {
      id: "tool-skill-enabled-hidden-tool",
      options: { allowedTools: ["search_web"] },
    },
  ];

  for (const scenario of scenarios) {
    it(`captures ${scenario.id}`, async () => {
      const snapshot = await renderPromptSnapshot({
        scenarioId: scenario.id,
        ...scenario.options,
      });

      assertCanonicalOrder(snapshot.metadata.sectionOrder);
      assertMetadata(snapshot, scenario.id, scenario.options.allowedTools ?? []);

      expect(snapshot.sections).toHaveLength(4);
      expect(snapshot.fragments.length).toBeGreaterThan(0);

      const policySection = snapshot.sections.find((section) => section.name === "policy");
      const situationSection = snapshot.sections.find((section) => section.name === "situation");
      const memorySection = snapshot.sections.find((section) => section.name === "memory");
      const identitySection = snapshot.sections.find((section) => section.name === "identity");

      expect(identitySection?.content).toContain("You are Athena");
      expect(memorySection?.content).toContain("Recent memory");
      expect(situationSection?.content).toContain(`Scenario ${scenario.id}`);

      const policyContent = policySection?.content ?? "";
      const situationContent = situationSection?.content ?? "";
      assertStaticDynamicSplit(policyContent, situationContent);
      assertPromptEnvelope(snapshot.fullPrompt);

      if (scenario.id === "tool-static-vs-dynamic-split") {
        assertDefaultToolVisible(situationContent);
      }

      if (scenario.id === "tool-no-available-tools") {
        assertNoToolMessage(situationContent);
      }

      if (scenario.id === "tool-skill-enabled-hidden-tool") {
        assertHiddenToolAppearsWhenAllowed(situationContent);
      }

      writePromptTextSnapshot(scenario.id, snapshot.fullPrompt);
      expect(snapshot).toMatchSnapshot();
    });
  }
});
