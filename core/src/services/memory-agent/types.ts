export enum MemoryType {
  Profile = "profile", // User traits, preferences, relationship closeness
  Event = "event", // Important channel events and milestones
  Channel = "channel", // Social rules, active hours, atmosphere
  Experience = "experience", // Bot's own experiences, promises, stances
}

export enum MemoryScope {
  User = "user", // Cross-channel user profiles
  Channel = "channel", // Channel-level traits + events
  Private = "private", // Private chat info (strict isolation)
}

export interface MemoryRecord {
  id: string;
  type: MemoryType;
  scope: MemoryScope;
  scopeId: string; // userId (for User scope) or channelKey (for Channel/Private)
  platform: string;
  content: string;
  importance: number; // 0-100, for core memory selection
  isCore: boolean; // Whether this memory is in the core memory budget
  createdAt: Date;
  updatedAt: Date;
}

export interface MemoryAgentConfig {
  compressionThreshold: number; // Event count to trigger compression (default: 80)
  compressionIntervalMs: number; // Timer interval for compression check (default: 3600000 = 1hr)
  inactivityTriggerMs: number; // Inactivity period to trigger compression (default: 1800000 = 30min)
  coreMemoryBudget: number; // Max chars for core memory injection (default: 2000)
  summaryModel?: string; // Model for compression/extraction tasks
  maxAgentSteps: number; // Max tool calls for memory agent (default: 15)
  retainRecentEntries: number; // Keep N most recent timeline entries uncompressed (default: 10)
}
