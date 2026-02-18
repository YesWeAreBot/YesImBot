import { Context, Random } from "koishi";

import type {
  AgentSummaryRecord,
  EventQueryOptions,
  MessageEventData,
  MessageRecord,
  Observation,
  Scope,
  TimelineEntry,
} from "./types";
import { TimelineEventType, TimelinePriority, TimelineStage } from "./types";

// Table name constant — schema declared in horizon service (Plan 03)
const TIMELINE_TABLE = "yesimbot.timeline" as any;

export class EventManager {
  private logger: ReturnType<Context["logger"]>;

  constructor(private ctx: Context) {
    this.logger = ctx.logger("horizon");
  }

  async record(entry: TimelineEntry): Promise<TimelineEntry> {
    return (this.ctx.database.create as any)(TIMELINE_TABLE, entry) as Promise<TimelineEntry>;
  }

  async query(options: EventQueryOptions): Promise<TimelineEntry[]> {
    const query: Record<string, any> = {};
    if (options.scope) query.scope = options.scope;
    if (options.types?.length) query.type = { $in: options.types };
    if (options.since) query.timestamp = { $gte: options.since };
    if (options.until) query.timestamp = { ...query.timestamp, $lte: options.until };

    let q = (this.ctx.database.select as any)(TIMELINE_TABLE).where(query);
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
    this.logger.debug(`record message ${data.data.senderId}: ${data.data.content}`);
    return this.record(entry) as Promise<MessageRecord>;
  }

  async recordAgentSummary(data: {
    scope: Scope;
    timestamp: Date;
    summary: string;
  }): Promise<AgentSummaryRecord> {
    const entry: AgentSummaryRecord = {
      id: Random.id(),
      type: TimelineEventType.AgentSummary,
      priority: TimelinePriority.Normal,
      stage: TimelineStage.Active,
      scope: data.scope,
      timestamp: data.timestamp,
      data: { summary: data.summary },
    };
    return this.record(entry) as Promise<AgentSummaryRecord>;
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
        };
      }
      return {
        type: "agent.summary" as const,
        timestamp: entry.timestamp,
        summary: entry.data.summary,
      };
    });
  }

  async markAsActive(scope: Scope, before?: Date): Promise<void> {
    const query: any = { scope, stage: TimelineStage.New };
    if (before) query.timestamp = { $lte: before };
    await (this.ctx.database.set as any)(TIMELINE_TABLE, query, {
      stage: TimelineStage.Active,
    });
  }
}
