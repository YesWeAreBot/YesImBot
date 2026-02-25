import { Context, Random, Logger, Query } from "koishi";

import { Scope } from "../shared/types";
import type {
  AgentResponseData,
  AgentResponseRecord,
  EventQueryOptions,
  MessageEventData,
  MessageRecord,
  Observation,
  TimelineEntry,
} from "./types";
import { TimelineEventType, TimelinePriority, TimelineStage } from "./types";

// Table name constant — schema declared in horizon service (Plan 03)
const TIMELINE_TABLE = "yesimbot.timeline";

export class EventManager {
  private logger: Logger;

  constructor(private ctx: Context) {
    this.logger = ctx.logger("horizon");
  }

  async record(entry: TimelineEntry): Promise<TimelineEntry> {
    return this.ctx.database.create(TIMELINE_TABLE, entry) as Promise<TimelineEntry>;
  }

  async query(options: EventQueryOptions): Promise<TimelineEntry[]> {
    const query: Query.Expr<TimelineEntry> = {};
    if (options.scope) query.scope = options.scope;
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
    scope: Scope;
    stage: TimelineStage;
    timestamp: Date;
    data: MessageEventData;
  }): Promise<MessageRecord> {
    const entry: MessageRecord = {
      id: Random.id(),
      type: TimelineEventType.Message,
      priority: TimelinePriority.Normal,
      ...data,
    };
    this.logger.info(`record message ${data.data.senderId}: ${data.data.content}`);
    return this.record(entry) as Promise<MessageRecord>;
  }

  async recordAgentResponse(data: {
    scope: Scope;
    timestamp: Date;
    data: AgentResponseData;
  }): Promise<AgentResponseRecord> {
    const entry: AgentResponseRecord = {
      id: Random.id(),
      type: TimelineEventType.AgentResponse,
      priority: TimelinePriority.Normal,
      stage: TimelineStage.Active,
      scope: data.scope,
      timestamp: data.timestamp,
      data: data.data,
    };
    return this.record(entry) as Promise<AgentResponseRecord>;
  }

  toObservations(entries: TimelineEntry[], _selfId?: string): Observation[] {
    return entries.map((entry) => {
      if (entry.type === TimelineEventType.Message) {
        return {
          type: "message" as const,
          timestamp: entry.timestamp,
          sender: { id: entry.data.senderId, type: "user", name: entry.data.senderName },
          messageId: entry.data.messageId,
          content: entry.data.content,
          stage: entry.stage,
          ...(entry.data.replyTo !== undefined && { replyTo: entry.data.replyTo }),
        };
      }
      return {
        type: "agent.response" as const,
        timestamp: entry.timestamp,
        data: entry.data,
      };
    });
  }

  async markAsActive(scope: Scope, before?: Date): Promise<void> {
    const query: Record<string, unknown> = { scope, stage: TimelineStage.New };
    if (before) query.timestamp = { $lte: before };
    await this.ctx.database.set(TIMELINE_TABLE, query, {
      stage: TimelineStage.Active,
    });
  }

  async archiveStale(scope: Scope, olderThanMs: number): Promise<void> {
    const cutoff = new Date(Date.now() - olderThanMs);
    const query = {
      scope,
      stage: TimelineStage.Active,
      timestamp: { $lte: cutoff },
    } as unknown as Query.Expr<TimelineEntry>;
    await this.ctx.database.set(TIMELINE_TABLE, query, { stage: TimelineStage.Archived });
  }
}
