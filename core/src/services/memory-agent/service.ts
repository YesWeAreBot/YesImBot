import { Context, Service } from "koishi";

import type { ChannelKey, Scenario } from "../runtime/contracts";
import { runMemoryExtraction } from "./agent";
import { MemoryRecallPlugin } from "./recall-plugin";
import type { MemoryAgentConfig, MemoryRecord } from "./types";
import { MemoryScope } from "./types";

declare module "koishi" {
  interface Context {
    "yesimbot.memory-agent": MemoryAgentService;
  }
  interface Tables {
    "yesimbot.memory": MemoryRecord;
  }
}

export interface MemoryAgentServiceConfig {
  memoryAgent: MemoryAgentConfig;
}

const DEFAULT_CONFIG: MemoryAgentConfig = {
  coreMemoryBudget: 2000,
  maxAgentSteps: 15,
};

export class MemoryAgentService extends Service<MemoryAgentServiceConfig> {
  static inject = [
    "database",
    "yesimbot.model",
    "yesimbot.horizon",
    "yesimbot.prompt",
    "yesimbot.hook",
  ];

  private extractionInProgress = new Map<string, Promise<void>>();
  private agentConfig: MemoryAgentConfig;

  constructor(ctx: Context, config: MemoryAgentServiceConfig) {
    super(ctx, "yesimbot.memory-agent", true);
    this.config = config;
    this.logger = ctx.logger("memory-agent");
    this.agentConfig = { ...DEFAULT_CONFIG, ...config.memoryAgent };
  }

  protected async start(): Promise<void> {
    // Declare database model
    this.ctx.model.extend(
      "yesimbot.memory",
      {
        id: "string(64)",
        type: "string(32)",
        scope: "string(16)",
        scopeId: "string(255)",
        platform: "string(64)",
        content: "text",
        importance: "unsigned",
        isCore: { type: "boolean", initial: false },
        createdAt: "timestamp",
        updatedAt: "timestamp",
      },
      { primary: "id", autoInc: false },
    );

    // Listen for compression events to trigger memory extraction
    this.ctx.on("athena:timeline.compressed", (channelKey) =>
      this.onTimelineCompressed(channelKey),
    );

    // Register core memories as canonical prompt fragment source
    const promptService = this.ctx["yesimbot.prompt"];
    promptService.registerFragmentSource("memory.core", async (scope) => {
      const scenario = scope.scenario as Scenario | undefined;
      if (!scenario?.raw.environment) return [];
      const key: ChannelKey = {
        platform: scenario.raw.environment.platform,
        channelId: scenario.raw.environment.channelId,
      };
      const memories = await this.getCoreMemories(key, scenario.raw.environment.platform);
      if (memories.length === 0) return [];
      const lines = memories.map((m) => `- [${m.type}] ${m.content}`);
      return [
        {
          id: "memory.core",
          content: `<core_memories>\n${lines.join("\n")}\n</core_memories>`,
          section: "memory",
          source: "memory",
          stability: "stable",
          priority: 500,
          cacheable: true,
        },
      ];
    });

    // Register recall tool plugin
    this.ctx.plugin(MemoryRecallPlugin);

    this.logger.info("MemoryAgentService started");
  }

  /**
   * Triggered after summary compression completes for a channel.
   */
  private async onTimelineCompressed(channelKey: {
    platform: string;
    channelId: string;
  }): Promise<void> {
    this.logger.info(
      `Timeline compressed for ${channelKey.platform}:${channelKey.channelId}, triggering memory extraction`,
    );
    await this.maybeRunAgent({
      platform: channelKey.platform,
      channelId: channelKey.channelId,
    });
  }

  /**
   * Run memory extraction for a channel if not already in progress.
   * Uses a Map to track in-progress extractions (same pattern as SummaryCompressor).
   */
  async maybeRunAgent(channelKey: ChannelKey): Promise<void> {
    const key = `${channelKey.platform}:${channelKey.channelId}`;

    if (this.extractionInProgress.has(key)) {
      this.logger.debug(`Memory extraction already in progress for ${key}, skipping`);
      return;
    }

    const extractionPromise = runMemoryExtraction(
      this.ctx,
      channelKey,
      channelKey.platform,
      this.agentConfig,
    ).finally(() => {
      this.extractionInProgress.delete(key);
    });

    this.extractionInProgress.set(key, extractionPromise);

    try {
      await extractionPromise;
    } catch (err) {
      this.logger.warn(`Memory extraction failed for ${key}:`, err);
    }
  }

  /**
   * Get core memories for a channel, respecting scope visibility rules.
   * - User-level memories are always visible
   * - Channel-level memories only in that channel
   * - Private-level memories only in DMs (caller must filter)
   */
  async getCoreMemories(channelKey: ChannelKey, platform: string): Promise<MemoryRecord[]> {
    const scopeId = `${platform}:${channelKey.channelId}`;

    const memories = await this.ctx.database.get("yesimbot.memory", {
      isCore: true,
      $or: [
        { scope: MemoryScope.User, platform },
        { scope: MemoryScope.Channel, scopeId },
      ],
    });

    return memories as MemoryRecord[];
  }
}
