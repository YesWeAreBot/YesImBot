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
}
