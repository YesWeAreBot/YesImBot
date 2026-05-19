import type { UserContent } from "@yesimbot/agent/ai";

import type { ChatMessagePayload, SerializedEvent } from "./types.js";

export interface AthenaEventMessage<K extends string = string, P = unknown> {
  customType: "athena:event";
  content: UserContent | [];
  display: boolean;
  details: SerializedEvent<K, P>;
}

export type ChatEventMessage = AthenaEventMessage<"chat_message", ChatMessagePayload>;

export type AthenaMessage = ChatEventMessage;
