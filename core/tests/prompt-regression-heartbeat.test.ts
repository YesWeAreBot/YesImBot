import { describe, expect, it } from "vitest";

import {
  CANONICAL_SECTION_ORDER,
  renderPromptSnapshot,
  writePromptTextSnapshot,
} from "./helpers/prompt-regression";

type HeartbeatScenario = {
  id: "heartbeat-timed-global" | "heartbeat-manual-trigger" | "heartbeat-policy-and-timeline-link";
  options: {
    triggerType: "timer";
    heartbeatSource: "global" | "manual";
    includeHeartbeatTimeline: true;
    includePolicyDocument: true;
  };
};

const EXPECTED_ORDER = ["identity", "policy", "memory", "situation"];

function assertCanonicalOrder(order: string[]): void {
  expect(order).toEqual(EXPECTED_ORDER);
  expect(order).toEqual(CANONICAL_SECTION_ORDER);
}

function assertPolicyWakeupModes(policyContent: string): void {
  expect(policyContent).toContain("## Control Flow and Wake-Up Mechanism");
  expect(policyContent).toContain("User messages");
  expect(policyContent).toContain("request_heartbeat");
  expect(policyContent).toContain("Timed heartbeats");
}

function assertHeartbeatTimeline(memoryContent: string): void {
  expect(memoryContent).toContain("Visible timeline event:");
  expect(memoryContent).toContain("<heartbeat");
  expect(memoryContent).toContain("Periodic check-in");
}

function assertPromptEnvelope(fullPrompt: string): void {
  expect(fullPrompt).toContain("<identity>");
  expect(fullPrompt).toContain("<policy>");
  expect(fullPrompt).toContain("<memory>");
  expect(fullPrompt).toContain("<situation>");
}

function assertTriggerSourceVisibility(fullPrompt: string): void {
  expect(fullPrompt).toMatch(/triggeredBy="(global|manual)"/);
}

describe("prompt regression heartbeat", () => {
  const scenarios: HeartbeatScenario[] = [
    {
      id: "heartbeat-timed-global",
      options: {
        triggerType: "timer",
        heartbeatSource: "global",
        includeHeartbeatTimeline: true,
        includePolicyDocument: true,
      },
    },
    {
      id: "heartbeat-manual-trigger",
      options: {
        triggerType: "timer",
        heartbeatSource: "manual",
        includeHeartbeatTimeline: true,
        includePolicyDocument: true,
      },
    },
    {
      id: "heartbeat-policy-and-timeline-link",
      options: {
        triggerType: "timer",
        heartbeatSource: "global",
        includeHeartbeatTimeline: true,
        includePolicyDocument: true,
      },
    },
  ];

  for (const scenario of scenarios) {
    it(`captures ${scenario.id}`, async () => {
      const snapshot = await renderPromptSnapshot({
        scenarioId: scenario.id,
        ...scenario.options,
      });

      assertCanonicalOrder(snapshot.metadata.sectionOrder);
      expect(snapshot.metadata.scenarioId).toBe(scenario.id);
      expect(snapshot.metadata.generatedAt).toBe("2026-03-15T10:00:00.000Z");
      expect(snapshot.metadata.stableSignature.length).toBeGreaterThan(10);
      expect(snapshot.metadata.sectionOrder).toEqual(EXPECTED_ORDER);
      expect(snapshot.metadata.loadedSkills).toEqual([]);
      expect(snapshot.metadata.allowedTools).toEqual([]);

      const policySection = snapshot.sections.find((section) => section.name === "policy");
      const memorySection = snapshot.sections.find((section) => section.name === "memory");
      const situationSection = snapshot.sections.find((section) => section.name === "situation");

      const policyContent = policySection?.content ?? "";
      const memoryContent = memorySection?.content ?? "";
      const situationContent = situationSection?.content ?? "";

      assertPolicyWakeupModes(policyContent);
      assertHeartbeatTimeline(memoryContent);
      expect(situationContent).toContain("<skills>");
      expect(situationContent).toContain("<tools>");

      assertPromptEnvelope(snapshot.fullPrompt);
      assertTriggerSourceVisibility(snapshot.fullPrompt);

      expect(snapshot.fullPrompt).toContain("trigger=timer");
      expect(snapshot.fullPrompt).toContain("## Control Flow and Wake-Up Mechanism");
      expect(snapshot.fullPrompt).toContain("request_heartbeat");
      expect(snapshot.fullPrompt).toContain("Timed heartbeats");
      expect(snapshot.fullPrompt).toContain("Periodic check-in");
      if (scenario.id === "heartbeat-manual-trigger") {
        expect(snapshot.fullPrompt).toContain('<heartbeat triggeredBy="manual"');
      } else {
        expect(snapshot.fullPrompt).toContain('<heartbeat triggeredBy="global"');
      }

      writePromptTextSnapshot(scenario.id, snapshot.fullPrompt);
      expect(snapshot).toMatchSnapshot();
    });
  }
});
