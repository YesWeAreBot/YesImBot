export const RUNTIME_CONTRACT_VERSION = "54.1";

export type TriggerType =
  | "mention"
  | "reply"
  | "keyword"
  | "random"
  | "direct"
  | "timer"
  | "internal";

export type ChannelKey = { platform: string; channelId: string };

export interface Percept {
  id: string;
  traceId: string;
  type: TriggerType;
  platform: string;
  channelId: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface Scenario {
  raw: {
    self: { id: string; name: string; role?: string };
    environment: {
      type: string;
      id: string;
      name: string;
      platform: string;
      channelId: string;
      description?: string;
    };
    entities: Array<{
      id: string;
      type: string;
      name: string;
      userId?: string;
      username?: string;
      nickname?: string;
      attributes?: Record<string, unknown>;
    }>;
    timeline: Array<Record<string, unknown>>;
    stimulusSource: {
      type: "message" | "event" | "system" | "timer" | "internal";
      messageId?: string;
      senderId?: string;
      triggerId?: string;
      ref?: Record<string, unknown>;
    };
  };
  derived: {
    focus: Record<string, unknown>;
    participants: Array<Record<string, unknown>>;
    attention: Record<string, unknown>;
    recentMetrics: Record<string, unknown>;
  };
}

export type CapabilityState =
  | {
      status: "available";
      detail?: string;
      limits?: Record<string, unknown>;
    }
  | {
      status: "unavailable";
      reason: string;
      recoverable?: boolean;
      detail?: string;
    };

export interface Capabilities {
  core: {
    sendMessage: CapabilityState;
    readHistory: CapabilityState;
    [key: string]: CapabilityState;
  };
  extended: Record<string, CapabilityState>;
}

export interface RoundSnapshot {
  version: number;
  createdAt: Date;
  scenario: Scenario;
  capabilities: Capabilities;
  metadata: Record<string, unknown>;
}

export interface SkillState {
  active: string[];
  metadata?: Record<string, unknown>;
}

export interface RoundContext {
  percept: Percept;
  scenario: Scenario;
  capabilities: Capabilities;
  metadata: Record<string, unknown>;
  skillState: SkillState;
  snapshot: RoundSnapshot;
}
