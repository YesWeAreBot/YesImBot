import { Session } from "koishi";

import { Scope, TriggerType } from "../shared/types";

// Re-export for backward compatibility
export { TriggerType };
export type { Scope } from "../shared/types";

// ---- Percept ----

export enum PerceptType {
  UserMessage = "user.message",
}

export interface BasePercept<T extends PerceptType> {
  id: string;
  type: T;
  scope: Scope;
  priority: number;
  timestamp: Date;
}

export interface UserMessagePercept extends BasePercept<PerceptType.UserMessage> {
  payload: {
    messageId: string;
    content: string;
    sender: { id: string; name: string; role?: string };
    channel: { id: string; platform: string; guildId?: string };
  };
  triggerType: TriggerType;
  runtime?: { session: Session };
}

export type Percept = UserMessagePercept;
