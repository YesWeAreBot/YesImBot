export interface AgentIdentity {
  name?: string;
  description?: string;
}

export interface AgentCoreConfig {
  provider?: string;
  model?: string;
  maxRounds?: number;
  streamMode?: boolean;
  globalTimeout?: number;
  maxToolResultLength?: number;
  identity?: AgentIdentity;
  willingnessProvider?: string;
  willingnessModel?: string;
  willingnessRejectThreshold?: number;
  willingnessAcceptThreshold?: number;
  willingCooldownMessages?: number;
  willingCooldownMs?: number;
  willingSoftDecayMs?: number;
  errorReportChannel?: string;
}
