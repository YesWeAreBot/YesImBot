import { Context, Random, Logger, Query } from "koishi";

import type { LoopMessage } from "../agent/trimmer";
import { ChannelKey } from "../shared/types";
import {
  MessageHandler,
  AgentResponseHandler,
  AgentActionHandler,
  SummaryHandler,
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

  buildLoopMessages(entries: TimelineEntry[], options: BuildContextOptions): LoopMessage[] {
    const messages: LoopMessage[] = [];
    for (const entry of entries) {
      for (const handler of this.handlers) {
        if (handler.canHandle(entry)) {
          messages.push(...handler.handle(entry, options));
          break;
        }
      }
    }
    return messages;
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
}
