import type { Session } from "koishi";

// ---- Shared Types ----

export type TriggerType = "mention" | "reply" | "keyword" | "random" | "direct";

export interface Scope {
  platform?: string;
  channelId?: string;
  guildId?: string;
  isDirect?: boolean;
}

export interface BasePerceptRef {
  id: string;
  type: string;
  scope: Scope;
  timestamp: Date;
}

export interface PerceptInput extends BasePerceptRef {
  runtime?: { session: Session };
}
