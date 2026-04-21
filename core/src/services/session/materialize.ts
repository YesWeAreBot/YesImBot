import type { ModelMessage, UserModelMessage } from "@ai-sdk/provider-utils";

import type { AthenaMessage } from "./messages/athena-message";
import type { SessionMessage } from "./messages/session-message";

export function convertToLlm(messages: SessionMessage[]): ModelMessage[] {
  return messages.map((message) => {
    if ("role" in message) {
      switch (message.role) {
        case "assistant":
        case "tool":
          return message;
        default: {
          const exhaustiveCheck: never = message;
          throw new Error(`Unsupported SessionMessage role: ${String(exhaustiveCheck)}`);
        }
      }
    }

    return athenaMessageToUserModelMessage(message);
  });
}

function athenaMessageToUserModelMessage(message: AthenaMessage): UserModelMessage {
  switch (message.type) {
    case "user.message":
    case "notice.member.join":
    case "notice.member.leave":
    case "notice.reaction":
    case "notice.state.update":
      return {
        role: "user",
        content: message.data.content,
      } satisfies UserModelMessage;
    default: {
      const exhaustiveCheck: never = message;
      throw new Error(`Unsupported AthenaMessage type: ${String(exhaustiveCheck)}`);
    }
  }
}
