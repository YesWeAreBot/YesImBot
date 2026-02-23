// ---- Shared Types ----

export type TriggerType =
  | "mention"
  | "reply"
  | "keyword"
  | "random"
  | "direct"
  | "timer"
  | "internal";

export interface Scope {
  platform?: string;
  channelId?: string;
  guildId?: string;
  userId?: string;
  isDirect?: boolean;
}

export interface Percept {
  id: string;
  type: TriggerType;
  scope: Scope;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface TraitSignal {
  dimension: string;
  value: string;
  confidence: number;
  metadata?: Record<string, unknown>;
}
