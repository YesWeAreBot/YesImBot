export interface AgentIdentity {
  name?: string;
  description?: string;
}

export interface AgentCoreConfig {
  model?: string;
  fallbackModel?: string;
  maxRounds?: number;
  streamMode?: boolean;
  globalTimeout?: number;
  maxToolResultLength?: number;
  identity?: AgentIdentity;
  willingnessModel?: string;
  willingnessRejectThreshold?: number;
  willingnessAcceptThreshold?: number;
  willingCooldownMessages?: number;
  willingCooldownMs?: number;
  willingSoftDecayMs?: number;
  errorReportChannel?: string;
}
