import type { WillingnessConfig } from "./willingness-config";

export interface AgentIdentity {
  name?: string;
  description?: string;
}

export interface AgentCoreConfig {
  model?: string;
  fallbackChain?: string[];
  maxRounds?: number;
  streamMode?: boolean;
  globalTimeout?: number;
  maxToolResultLength?: number;
  identity?: AgentIdentity;
  willingness?: WillingnessConfig;
  errorReportChannel?: string;
}
