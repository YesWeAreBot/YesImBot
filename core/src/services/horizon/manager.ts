import { Context, Random, Logger, Query } from "koishi";

import type { LoopMessage } from "../agent/trimmer";
import type { ScenarioTimeline, ScenarioTimelineEvent } from "../runtime/contracts";
import { ChannelKey } from "../shared/types";
import {
  MessageHandler,
  AgentResponseHandler,
  AgentActionHandler,
  SummaryHandler,
  HeartbeatHandler,
  BuildContextOptions,
  type TimelineHandler,
} from "./handlers";
import type {
  AgentActionData,
  AgentActionRecord,
  AgentResponseData,
  AgentResponseRecord,
  EventQueryOptions,
  MessageEventData,
  MessageRecord,
  Observation,
  SummaryData,
  TimelineEntry,
} from "./types";
import { TimelineEventType, TimelinePriority, TimelineStage } from "./types";

// Table name constant — schema declared in horizon service (Plan 03)
const TIMELINE_TABLE = "yesimbot.timeline";

export class EventManager {
  private logger: Logger;
  private handlers: TimelineHandler<TimelineEntry>[] = [
    new MessageHandler(),
    new AgentResponseHandler(),
    new AgentActionHandler(),
    new SummaryHandler(),
    new HeartbeatHandler(),
  ];

  constructor(private ctx: Context) {
    this.logger = ctx.logger("horizon");
  }

  async record(entry: TimelineEntry): Promise<TimelineEntry> {
    return this.ctx.database.create(TIMELINE_TABLE, entry) as Promise<TimelineEntry>;
  }

  async query(options: EventQueryOptions): Promise<TimelineEntry[]> {
    const query: Query.Expr<TimelineEntry> = {};
    if (options.key) {
      query.platform = options.key.platform as unknown as Query.Expr<TimelineEntry>["platform"];
      query.channelId = options.key.channelId as unknown as Query.Expr<TimelineEntry>["channelId"];
    }
    if (options.types?.length)
      query.type = { $in: options.types } as unknown as Query.Expr<TimelineEntry>["type"];
    if (options.stages?.length)
      query.stage = { $in: options.stages } as unknown as Query.Expr<TimelineEntry>["stage"];
    if (options.since) query.timestamp = { $gte: options.since };
    if (options.until) query.timestamp = { ...(query.timestamp as object), $lte: options.until };

    let q = this.ctx.database.select(TIMELINE_TABLE).where(query);
    if (options.orderBy) q = q.orderBy("timestamp", options.orderBy);
    if (options.limit) q = q.limit(options.limit);
    return q.execute() as Promise<TimelineEntry[]>;
  }

  async recordMessage(data: {
    platform: string;
    channelId: string;
    stage: TimelineStage;
    timestamp: Date;
    data: MessageEventData;
  }): Promise<MessageRecord> {
    const entry: MessageRecord = {
      id: Random.id(),
      type: TimelineEventType.Message,
      priority: TimelinePriority.Normal,
      platform: data.platform,
      channelId: data.channelId,
      stage: data.stage,
      timestamp: data.timestamp,
      data: data.data,
    };
    this.logger.info(`record message ${data.data.senderId}: ${data.data.content}`);
    return this.record(entry) as Promise<MessageRecord>;
  }

  async recordAgentResponse(data: {
    platform: string;
    channelId: string;
    timestamp: Date;
    data: AgentResponseData;
  }): Promise<AgentResponseRecord> {
    const entry: AgentResponseRecord = {
      id: Random.id(),
      type: TimelineEventType.AgentResponse,
      priority: TimelinePriority.Normal,
      stage: TimelineStage.Active,
      platform: data.platform,
      channelId: data.channelId,
      timestamp: data.timestamp,
      data: data.data,
    };
    return this.record(entry) as Promise<AgentResponseRecord>;
  }

  async recordAgentAction(data: {
    platform: string;
    channelId: string;
    timestamp: Date;
    data: AgentActionData;
  }): Promise<AgentActionRecord> {
    const entry: AgentActionRecord = {
      id: Random.id(),
      type: TimelineEventType.AgentAction,
      priority: TimelinePriority.Normal,
      stage: TimelineStage.Active,
      platform: data.platform,
      channelId: data.channelId,
      timestamp: data.timestamp,
      data: data.data,
    };
    return this.record(entry) as Promise<AgentActionRecord>;
  }

  async recordSummary(params: {
    platform: string;
    channelId: string;
    timestamp: Date;
    data: SummaryData;
  }): Promise<void> {
    await this.record({
      id: Random.id(),
      type: TimelineEventType.Summary,
      priority: TimelinePriority.Core,
      stage: TimelineStage.Active,
      platform: params.platform,
      channelId: params.channelId,
      timestamp: params.timestamp,
      data: params.data,
    });
  }

  async buildLoopMessages(
    entries: TimelineEntry[] | ScenarioTimeline,
    options: BuildContextOptions,
  ): Promise<LoopMessage[]> {
    const timelineEntries = Array.isArray(entries)
      ? entries
      : this.adaptScenarioTimelineEntries(entries, options);
    const { imageConfig, parseElements, getImageCache } = options;

    // Image lifecycle tracking
    const lifecycleTracker = new Map<string, number>();
    const selectedImages = new Set<string>();

    // Pass 1: Collect all image candidates if native mode enabled
    if (imageConfig?.imageMode === "native" && parseElements && getImageCache) {
      const candidates: Array<{ id: string; index: number }> = [];

      for (let i = 0; i < timelineEntries.length; i++) {
        const entry = timelineEntries[i];
        if (entry.type !== "message") continue;

        const elements = parseElements(entry.data.content);
        const imgElements = elements.filter((el) => el.type === "img");

        for (const el of imgElements) {
          const id = el.attrs.id as string | undefined;
          const status = el.attrs.status as string | undefined;
          if (!id || status === "failed") continue;

          const cache = await getImageCache(id);
          if (!cache || cache.status === "failed") continue;

          const count = lifecycleTracker.get(id) ?? 0;
          if (count >= imageConfig.imageLifecycleCount) continue;

          candidates.push({ id, index: i });
        }
      }

      // FIFO: Keep last N images
      const keepFrom = Math.max(0, candidates.length - imageConfig.maxImagesInContext);
      for (let i = keepFrom; i < candidates.length; i++) {
        selectedImages.add(candidates[i].id);
      }
    }

    // Pass 2: Build messages with image embedding decisions
    const enhancedOptions: BuildContextOptions = {
      ...options,
      shouldEmbedImage: (id: string) => selectedImages.has(id),
      incrementLifecycle: (id: string) => {
        lifecycleTracker.set(id, (lifecycleTracker.get(id) ?? 0) + 1);
      },
    };

    const messages: LoopMessage[] = [];
    for (const entry of timelineEntries) {
      for (const handler of this.handlers) {
        if (handler.canHandle(entry)) {
          const handlerMessages = await handler.handle(entry, enhancedOptions);
          messages.push(...handlerMessages);
          break;
        }
      }
    }
    return messages;
  }

  private adaptScenarioTimelineEntries(
    timeline: ScenarioTimeline,
    options: BuildContextOptions,
  ): TimelineEntry[] {
    const { platform, channelId } = this.resolveChannelIdentity(options.channelKey);
    const entries: TimelineEntry[] = [];

    for (const turn of timeline.turns) {
      for (const message of turn.messages) {
        entries.push({
          id: message.id,
          type: TimelineEventType.Message,
          priority: TimelinePriority.Normal,
          stage: TimelineStage.Active,
          platform,
          channelId,
          timestamp: message.timestamp,
          data: {
            messageId: message.messageId,
            senderId: message.senderId,
            senderName: message.senderName,
            content: message.content,
          },
        });
      }

      const turnEvents = turn.events;
      for (let i = 0; i < turnEvents.length; i += 1) {
        const event = turnEvents[i];
        if (event.type !== "agent.action") {
          continue;
        }

        const actionNames = readStringArray(event.detail?.actionNames);
        const actions = actionNames.map((name) => ({ name }));
        const toolResults: AgentActionData["toolResults"] = [];

        let cursor = i + 1;
        while (cursor < turnEvents.length && turnEvents[cursor]?.type === "tool.result") {
          const toolResult = this.toToolResult(turnEvents[cursor]);
          if (toolResult) {
            toolResults.push(toolResult);
          }
          cursor += 1;
        }

        entries.push({
          id: event.id,
          type: TimelineEventType.AgentAction,
          priority: TimelinePriority.Normal,
          stage: TimelineStage.Active,
          platform,
          channelId,
          timestamp: event.timestamp,
          data: {
            actions,
            toolResults,
          },
        });

        i = cursor - 1;
      }
    }

    return entries;
  }

  private toToolResult(
    event: ScenarioTimelineEvent,
  ): AgentActionData["toolResults"][number] | undefined {
    if (event.type !== "tool.result") {
      return undefined;
    }
    const name = readString(event.detail?.name);
    if (!name) {
      return undefined;
    }
    return {
      name,
      success: event.detail?.success === true,
      status: readString(event.detail?.status),
      result: event.detail?.result,
      error: readString(event.detail?.error),
    };
  }

  private resolveChannelIdentity(channelKey?: string): { platform: string; channelId: string } {
    if (!channelKey) {
      return { platform: "unknown-platform", channelId: "unknown-channel" };
    }
    const separatorIndex = channelKey.indexOf(":");
    if (separatorIndex <= 0) {
      return { platform: channelKey, channelId: channelKey };
    }
    return {
      platform: channelKey.slice(0, separatorIndex),
      channelId: channelKey.slice(separatorIndex + 1),
    };
  }

  async markAsActive(key: ChannelKey, before?: Date): Promise<void> {
    const query: Record<string, unknown> = {
      platform: key.platform,
      channelId: key.channelId,
      stage: TimelineStage.New,
    };
    if (before) query.timestamp = { $lte: before };
    await this.ctx.database.set(TIMELINE_TABLE, query, {
      stage: TimelineStage.Active,
    });
  }

  async archiveStale(key: ChannelKey, olderThanMs: number): Promise<void> {
    const cutoff = new Date(Date.now() - olderThanMs);
    const query = {
      platform: key.platform,
      channelId: key.channelId,
      stage: TimelineStage.Active,
      timestamp: { $lte: cutoff },
    } as unknown as Query.Expr<TimelineEntry>;
    await this.ctx.database.set(TIMELINE_TABLE, query, { stage: TimelineStage.Archived });
  }

  async deleteStale(key: ChannelKey, stage: TimelineStage): Promise<number> {
    const query = {
      platform: key.platform,
      channelId: key.channelId,
      stage: stage,
    } as unknown as Query.Expr<TimelineEntry>;
    const entries = await this.ctx.database.select(TIMELINE_TABLE).where(query).execute();
    if (entries.length === 0) return 0;
    await this.ctx.database.remove(TIMELINE_TABLE, query);
    return entries.length;
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}
