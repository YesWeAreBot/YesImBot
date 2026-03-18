/**
 * Configuration for the ArousalService heartbeat system.
 */
export interface ArousalConfig {
  debugLevel?: number;
  /** Master switch for the arousal system (default: false) */
  enabled: boolean;
  /** Global heartbeat interval in milliseconds (default: 1800000 = 30 min) */
  heartbeatIntervalMs: number;
  /** Channels excluded from heartbeat (format: "platform:channelId") */
  excludeChannels: string[];
  /** Max proactive messages per channel per day (default: 3) */
  dailyMessageLimit: number;
  /** Small model for global channel evaluation (falls back to summaryModel) */
  evaluationModel?: string;
}

/** Result from channel evaluation - a channel selected for heartbeat */
export interface SelectedChannel {
  platform: string;
  channelId: string;
  reason: string;
}

/** Daily message count tracking per channel */
export interface DailyMessageCount {
  count: number;
  resetAt: number;
}
