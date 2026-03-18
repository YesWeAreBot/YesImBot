import { describe, expect, it } from "vitest";

import {
  CANONICAL_SECTION_ORDER,
  renderPromptSnapshot,
  writePromptTextSnapshot,
} from "./helpers/prompt-regression";

type SkillScenario = {
  id: "skill-catalog-unloaded" | "skill-catalog-loaded-single" | "skill-catalog-loaded-multiple";
  loadedSkills: string[];
  expectedLoaded: string[];
  expectedUnloaded: string[];
};

const EXPECTED_ORDER = ["identity", "policy", "memory", "situation"];

function assertCanonicalOrder(order: string[]): void {
  expect(order).toEqual(EXPECTED_ORDER);
  expect(order).toEqual(CANONICAL_SECTION_ORDER);
}

function assertNoSkillBodyLeakage(fullPrompt: string): void {
  expect(fullPrompt).not.toContain("## Skill Guidance");
  expect(fullPrompt).not.toContain("### Goal");
  expect(fullPrompt).not.toContain("### Inputs");
  expect(fullPrompt).not.toContain("### Procedure");
  expect(fullPrompt).not.toContain("Step 1:");
  expect(fullPrompt).not.toContain("Step 2:");
  expect(fullPrompt).not.toContain("Step 3:");
}

function assertSkillCatalogShell(situationContent: string): void {
  expect(situationContent).toContain("<skills>");
  expect(situationContent).toContain("Registered skills (use loadSkill to activate):");
  expect(situationContent).toContain("mention-aware: Handle mention trigger nuances.");
  expect(situationContent).toContain("search-service: Use search tools when needed.");
  expect(situationContent).toContain("forward-present: Summarize and forward context.");
  expect(situationContent).toContain("</skills>");
}

function assertLoadedMarkers(
  situationContent: string,
  expectedLoaded: string[],
  expectedUnloaded: string[],
): void {
  for (const skillName of expectedLoaded) {
    expect(situationContent).toContain(`${skillName}:`);
    expect(situationContent).toContain(`${skillName}:`);
    expect(situationContent).toContain(" [loaded]");
  }

  for (const skillName of expectedUnloaded) {
    const skillLine = situationContent.split("\n").find((line) => line.includes(`${skillName}:`));
    expect(skillLine).toBeDefined();
    expect(skillLine).not.toContain("[loaded]");
  }
}

function assertMetadata(
  snapshot: Awaited<ReturnType<typeof renderPromptSnapshot>>,
  expectedScenario: string,
  expectedLoadedSkills: string[],
): void {
  expect(snapshot.metadata.scenarioId).toBe(expectedScenario);
  expect(snapshot.metadata.generatedAt).toBe("2026-03-15T10:00:00.000Z");
  expect(snapshot.metadata.loadedSkills).toEqual(expectedLoadedSkills);
  expect(snapshot.metadata.allowedTools).toEqual([]);
  expect(snapshot.metadata.stableSignature.length).toBeGreaterThan(10);
}

describe("prompt regression skill", () => {
  const scenarios: SkillScenario[] = [
    {
      id: "skill-catalog-unloaded",
      loadedSkills: [],
      expectedLoaded: [],
      expectedUnloaded: ["mention-aware", "search-service", "forward-present"],
    },
    {
      id: "skill-catalog-loaded-single",
      loadedSkills: ["search-service"],
      expectedLoaded: ["search-service"],
      expectedUnloaded: ["mention-aware", "forward-present"],
    },
    {
      id: "skill-catalog-loaded-multiple",
      loadedSkills: ["search-service", "mention-aware"],
      expectedLoaded: ["search-service", "mention-aware"],
      expectedUnloaded: ["forward-present"],
    },
  ];

  for (const scenario of scenarios) {
    it(`captures ${scenario.id}`, async () => {
      const snapshot = await renderPromptSnapshot({
        scenarioId: scenario.id,
        skillsLoaded: scenario.loadedSkills,
      });

      assertCanonicalOrder(snapshot.metadata.sectionOrder);
      assertMetadata(snapshot, scenario.id, scenario.loadedSkills);

      expect(snapshot.sections).toHaveLength(4);
      expect(snapshot.fragments.length).toBeGreaterThan(0);

      const situationSection = snapshot.sections.find((section) => section.name === "situation");
      const policySection = snapshot.sections.find((section) => section.name === "policy");

      expect(policySection?.content).toContain("## Tool Protocol");
      expect(situationSection?.content).toContain("<tools>");
      expect(situationSection?.content).toContain(`Scenario ${scenario.id}`);

      const situationContent = situationSection?.content ?? "";
      assertSkillCatalogShell(situationContent);

      if (scenario.id === "skill-catalog-unloaded") {
        expect(situationContent).not.toContain(" [loaded]");
      }

      assertLoadedMarkers(situationContent, scenario.expectedLoaded, scenario.expectedUnloaded);

      assertNoSkillBodyLeakage(snapshot.fullPrompt);
      expect(snapshot.fullPrompt).toContain("<identity>");
      expect(snapshot.fullPrompt).toContain("<policy>");
      expect(snapshot.fullPrompt).toContain("<memory>");
      expect(snapshot.fullPrompt).toContain("<situation>");

      writePromptTextSnapshot(scenario.id, snapshot.fullPrompt);
      expect(snapshot).toMatchSnapshot();
    });
  }
});
