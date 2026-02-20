type AllowedChannel = { platform: string; type: "private" | "guild"; id: string };
export interface ListenerConfig {
  allowedChannels: AllowedChannel[];
  keywords?: string[];
  aggregationWindow?: number;
}

export interface HorizonServiceConfig extends ListenerConfig {
  historyLimit?: number;
  archiveThresholdMs?: number;
  botName?: string;
  entityCacheTtl?: number;
  maxActiveEntities?: number;
}
