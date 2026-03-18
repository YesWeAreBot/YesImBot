import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Context } from "koishi";

import type {
  Capabilities,
  RoundContext,
  Scenario,
  ScenarioTimeline,
  ScenarioTurnMessage,
  TriggerType,
} from "../../src/runtime/contracts";
import { buildToolPromptFragments } from "../../src/services/agent/tools";
import type { PluginService } from "../../src/services/plugin/service";
import { FunctionType, type ToolExecutionContext } from "../../src/services/plugin/types";
import { PromptService } from "../../src/services/prompt/service";
import { PROMPT_SECTION_LAYOUT, type PromptFragment } from "../../src/services/prompt/types";

export const FIXED_TIMESTAMP = new Date("2026-03-15T10:00:00.000Z");
export const TEST_PERCEPT_ID = "test-percept";
export const TEST_TRACE_ID = "test-trace";
export const TEST_TURN_ID = "turn-0001";
export const TEXT_SNAPSHOT_DIR = "core/tests/snapshots/prompt-regression/";

const SKILL_CATALOG = [
  { name: "mention-aware", description: "Handle mention trigger nuances." },
  { name: "search-service", description: "Use search tools when needed." },
  { name: "forward-present", description: "Summarize and forward context." },
];

const POLICY_DOC_PATH = resolve(__dirname, "..", "..", "resources", "roles", "POLICY.md");
const POLICY_DOC_CONTENT = readFileSync(POLICY_DOC_PATH, "utf-8").trim();

export interface RoundContextFixtureOptions {
  triggerType?: TriggerType;
  isDirect?: boolean;
  heartbeatSource?: "global" | "manual";
  messages?: string[];
  skillsLoaded?: string[];
  allowedTools?: string[];
  longHistory?: boolean;
  imageMessages?: boolean;
  compressedTimeline?: boolean;
  includeHeartbeatTimeline?: boolean;
  includePolicyDocument?: boolean;
}

export interface RenderPromptSnapshotOptions extends RoundContextFixtureOptions {
  scenarioId: string;
  toolMode?: "default" | "none";
}

function createPromptService(): PromptService {
  const ctx = {
    logger: () => ({
      level: 2,
      info: () => undefined,
      debug: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    }),
    on: () => undefined,
  } as unknown as Context;
  return new PromptService(ctx, {});
}

function createCapabilities(): Capabilities {
  return {
    core: {
      "message.send": { status: "available", source: "test" },
      "message.read_history": { status: "available", source: "test" },
    },
    extended: {},
  };
}

function createTimeline(
  messages: ScenarioTurnMessage[],
  heartbeatSource: "global" | "manual",
): ScenarioTimeline {
  const coveredUntil = new Date(FIXED_TIMESTAMP.getTime() - 30_000);
  return {
    turns: [
      {
        id: TEST_TURN_ID,
        startedAt: new Date(FIXED_TIMESTAMP.getTime() - 120_000),
        settledAt: new Date(FIXED_TIMESTAMP.getTime() - 60_000),
        settlement: "success",
        messages,
        events: [
          {
            id: "event-0001",
            type: "message",
            timestamp: new Date(FIXED_TIMESTAMP.getTime() - 90_000),
            detail: { source: "fixture" },
          },
          {
            id: "event-heartbeat-0001",
            type: "heartbeat",
            timestamp: new Date(FIXED_TIMESTAMP.getTime() - 80_000),
            detail: { source: heartbeatSource },
          },
        ],
        participants: [{ id: "user-1", name: "User One", type: "human" }],
        visibleOutputs: [],
      },
    ],
    latestSummary: {
      id: "summary-0001",
      timestamp: new Date(FIXED_TIMESTAMP.getTime() - 40_000),
      coveredUntil,
      content: "Previous context summary.",
    },
    activeSegment: {
      mode: "after-latest-summary",
      summaryId: "summary-0001",
      startedAt: coveredUntil,
    },
    markedEvents: [],
    heartbeatEvents: [
      {
        id: "hb-0001",
        timestamp: new Date(FIXED_TIMESTAMP.getTime() - 80_000),
        triggeredBy: heartbeatSource,
        detail: { channelSummary: "Periodic check-in" },
      },
    ],
    semantics: {
      summaryPosition: "background",
      heartbeatRendering: "visible",
      agentResponseVisibility: "internal-draft",
      visibleOutputSource: "send_message-success",
      defaultQueryWindow: "active-segment",
    },
  };
}

export function buildRoundContextFixture(options: RoundContextFixtureOptions = {}): RoundContext {
  const triggerType = options.triggerType ?? "mention";
  const isDirect = options.isDirect ?? false;
  const heartbeatSource = options.heartbeatSource ?? "global";
  const loadedSkills = options.skillsLoaded ?? [];

  const baseMessages = options.messages ?? ["hello athena", "please help summarize this thread"];
  const timelineMessages = baseMessages.map((content, idx) => ({
    id: `turn-message-${idx + 1}`,
    messageId: `message-${idx + 1}`,
    senderId: `user-${idx + 1}`,
    senderName: `User ${idx + 1}`,
    content,
    timestamp: new Date(FIXED_TIMESTAMP.getTime() - (idx + 1) * 10_000),
  }));

  if (options.longHistory) {
    timelineMessages.push({
      id: "turn-message-long",
      messageId: "message-long",
      senderId: "user-99",
      senderName: "Long History User",
      content: "Long history entry: " + "lorem ipsum ".repeat(30),
      timestamp: new Date(FIXED_TIMESTAMP.getTime() - 55_000),
    });
  }

  if (options.imageMessages) {
    timelineMessages.push({
      id: "turn-message-image",
      messageId: "message-image",
      senderId: "user-img",
      senderName: "Image Sender",
      content: "[image] uploaded chart screenshot",
      timestamp: new Date(FIXED_TIMESTAMP.getTime() - 25_000),
    });
  }

  const timeline = createTimeline(timelineMessages, heartbeatSource);
  if (options.compressedTimeline) {
    timeline.latestSummary = {
      id: "summary-compressed-0001",
      timestamp: new Date(FIXED_TIMESTAMP.getTime() - 10_000),
      coveredUntil: new Date(FIXED_TIMESTAMP.getTime() - 10_000),
      content: "Compressed timeline summary active.",
    };
  }

  const scenario: Scenario = {
    raw: {
      self: { id: "athena-bot", name: "Athena" },
      environment: {
        type: isDirect ? "direct" : "group",
        id: isDirect ? "dm-1" : "group-1",
        name: isDirect ? "Direct Channel" : "General",
        platform: "discord",
        channelId: isDirect ? "dm-1" : "group-1",
      },
      entities: [],
      timeline,
      scenarioTimeline: timeline,
      stimulusSource: {
        type: triggerType === "timer" ? "timer" : "message",
        messageId: "message-1",
        senderId: "user-1",
      },
    },
    derived: {
      focus: { triggerType, isDirect },
      participants: [{ id: "user-1", name: "User One" }],
      attention: {},
      recentMetrics: {},
    },
  };

  const capabilities = createCapabilities();
  const metadata = {
    channelKey: `${isDirect ? "discord:dm-1" : "discord:group-1"}`,
    traceId: TEST_TRACE_ID,
    allowedTools: options.allowedTools ?? [],
  };

  return {
    percept: {
      id: TEST_PERCEPT_ID,
      traceId: TEST_TRACE_ID,
      type: triggerType,
      platform: "discord",
      channelId: isDirect ? "dm-1" : "group-1",
      timestamp: FIXED_TIMESTAMP,
      metadata: { heartbeatSource },
    },
    scenario,
    capabilities,
    metadata,
    skillState: {
      active: [...loadedSkills],
      loadHistory: loadedSkills.map((name) => ({
        name,
        status: "loaded" as const,
        timestamp: FIXED_TIMESTAMP.getTime(),
      })),
      persistentRoster: [...loadedSkills],
    },
    snapshot: {
      version: 1,
      createdAt: FIXED_TIMESTAMP,
      scenario,
      capabilities,
      metadata,
    },
  };
}

function buildSkillCatalogFragment(loadedSkills: string[]): PromptFragment {
  const loadedSet = new Set(loadedSkills);
  const content = ["<skills>", "Registered skills (use loadSkill to activate):"]
    .concat(
      SKILL_CATALOG.map((skill) => {
        const loadedMarker = loadedSet.has(skill.name) ? " [loaded]" : "";
        return `- ${skill.name}: ${skill.description}${loadedMarker}`;
      }),
    )
    .concat(["</skills>"])
    .join("\n");

  return {
    id: "skill.catalog",
    content,
    section: "situation",
    source: "skill",
    priority: 510,
    stability: "dynamic",
    cacheable: false,
  };
}

function createMockPluginService(toolMode: "default" | "none"): PluginService {
  type ToolEntry = ReturnType<PluginService["getTools"]>[number];

  const visible: ToolEntry[] =
    toolMode === "none"
      ? []
      : [
          {
            type: "function",
            function: {
              name: "send_message",
              description: "Send a message to current channel",
              parameters: { type: "object", properties: { content: { type: "string" } } },
            },
            functionType: FunctionType.Action,
          },
        ];

  const hidden: ToolEntry[] = [
    {
      type: "function",
      function: {
        name: "search_web",
        description: "Search web for factual lookups",
        parameters: { type: "object", properties: { query: { type: "string" } } },
      },
      functionType: FunctionType.Tool,
    },
  ];

  return {
    getTools: (_ctx: ToolExecutionContext, includeHidden?: boolean) =>
      includeHidden ? visible.concat(hidden) : visible,
    getDefinition: (name: string) => {
      if (name === "send_message") return { type: FunctionType.Action };
      if (name === "search_web") return { type: FunctionType.Tool, hidden: true };
      return undefined;
    },
  } as unknown as PluginService;
}

export async function renderPromptSnapshot(options: RenderPromptSnapshotOptions): Promise<{
  sections: Array<{ name: string; content: string; cacheable?: boolean }>;
  fragments: PromptFragment[];
  metadata: {
    scenarioId: string;
    generatedAt: string;
    stableSignature: string;
    sectionOrder: string[];
    loadedSkills: string[];
    allowedTools: string[];
  };
  fullPrompt: string;
}> {
  const roundContext = buildRoundContextFixture(options);
  const promptService = createPromptService();
  const fragments: PromptFragment[] = [];

  const register = (
    sourceName: string,
    provider: (scope: Record<string, unknown>) => PromptFragment[] | Promise<PromptFragment[]>,
  ) => {
    promptService.registerFragmentSource(sourceName, async (scope) => {
      const result = await provider(scope);
      fragments.push(...result);
      return result;
    });
  };

  register("fixture.identity", () => [
    {
      id: "fixture.identity",
      content: "You are Athena. Respond naturally and helpfully.",
      section: "identity",
      source: "persona",
      priority: 900,
      stability: "stable",
      cacheable: true,
    },
  ]);

  register("fixture.policy", () => [
    {
      id: "fixture.policy",
      content: options.includePolicyDocument
        ? POLICY_DOC_CONTENT
        : "Follow platform policy and heartbeat interpretation guidance.",
      section: "policy",
      source: "persona",
      priority: 800,
      stability: "stable",
      cacheable: true,
    },
  ]);

  register("fixture.memory", () => [
    {
      id: "fixture.memory",
      content: (() => {
        const memoryLines = [
          "Recent memory:",
          ...(roundContext.scenario.raw.timeline.turns[0]?.messages ?? []).map(
            (message) => `- ${message.senderName}: ${message.content}`,
          ),
        ];

        if ((roundContext.scenario.raw.timeline.turns[0]?.messages?.length ?? 0) === 0) {
          memoryLines.push("");
        }

        if (options.includeHeartbeatTimeline) {
          const latestHeartbeat = roundContext.scenario.raw.timeline.heartbeatEvents.at(-1);
          const heartbeatReason =
            typeof latestHeartbeat?.detail?.channelSummary === "string" &&
            latestHeartbeat.detail.channelSummary.trim().length > 0
              ? latestHeartbeat.detail.channelSummary
              : "Periodic check-in";
          memoryLines.push(
            "",
            "Visible timeline event:",
            `<heartbeat triggeredBy="${latestHeartbeat?.triggeredBy ?? "manual"}">${heartbeatReason}</heartbeat>`,
          );
        }

        return memoryLines.join("\n");
      })(),
      section: "memory",
      source: "memory",
      priority: 700,
      stability: "dynamic",
      cacheable: false,
    },
  ]);

  register("fixture.skills", () => [buildSkillCatalogFragment(options.skillsLoaded ?? [])]);

  register("fixture.tooling", () => {
    const pluginService = createMockPluginService(options.toolMode ?? "default");
    const toolCtx: ToolExecutionContext = {
      platform: roundContext.percept.platform,
      channelId: roundContext.percept.channelId,
      capabilities: roundContext.capabilities,
    };
    return buildToolPromptFragments(pluginService, toolCtx, options.allowedTools);
  });

  register("fixture.situation", () => [
    {
      id: "fixture.situation",
      content: `Scenario ${options.scenarioId} trigger=${roundContext.percept.type}`,
      section: "situation",
      source: "scenario",
      priority: 600,
      stability: "dynamic",
      cacheable: false,
    },
  ]);

  const emitted = await promptService.emitPromptBlocks(
    "system",
    {
      percept: roundContext.percept,
      roundContext,
      scenario: roundContext.scenario,
      capabilities: roundContext.capabilities,
    },
    { providerType: "anthropic" },
  );

  const sections = emitted.sections.map((section) => ({
    name: section.name,
    content: section.content,
    cacheable: section.cacheable,
  }));

  return {
    sections,
    fragments,
    metadata: {
      scenarioId: options.scenarioId,
      generatedAt: FIXED_TIMESTAMP.toISOString(),
      stableSignature: emitted.stableSignature,
      sectionOrder: sections.map((section) => section.name),
      loadedSkills: [...(options.skillsLoaded ?? [])],
      allowedTools: [...(options.allowedTools ?? [])],
    },
    fullPrompt: sections.map((section) => section.content).join("\n\n"),
  };
}

export function writePromptTextSnapshot(filename: string, content: string): void {
  const snapshotDir = resolve(__dirname, "..", "snapshots", "prompt-regression");
  mkdirSync(snapshotDir, { recursive: true });
  const normalized = content.endsWith("\n") ? content : `${content}\n`;
  writeFileSync(resolve(snapshotDir, `${filename}.md`), normalized, "utf-8");
}

export const CANONICAL_SECTION_ORDER = [...PROMPT_SECTION_LAYOUT];
