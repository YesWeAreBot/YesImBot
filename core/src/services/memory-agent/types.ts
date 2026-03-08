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
  coreMemoryBudget: number; // Max chars for core memory injection (default: 2000)
  summaryModel?: string; // Model for memory extraction tasks (separate from timeline compression)
  maxAgentSteps: number; // Max tool calls for memory agent (default: 15)
}
