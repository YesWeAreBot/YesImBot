import type { TurnResult } from "@yesimagent/core";
import type { Awaitable, Session, Universal } from "koishi";

import type { ChannelContext } from "../channels/index.js";
import { isMessage, type AgentMessageOf } from "../messages/index.js";

/** What a `WillEngine` receives: the channel custom-message wrappers, not their payloads. */
export type ChannelInput = AgentMessageOf<"yesimbot.message"> | AgentMessageOf<"yesimbot.event">;

export const defaultWillEngine: WillEngine = {
  decide(input: ChannelInput, _state: WillState): "wait" | "trigger" {
    if (!isMessage(input)) return "wait";
    if (input.data.channel.type === (1 satisfies Universal.Channel.Type)) return "trigger";
    return input.data.elements.some((element) => element.type === "at" && String(element.attrs.id) === input.data.selfId) ? "trigger" : "wait";
  },
  debug(): WillDebug {
    return {
      engine: "default",
      config: { direct: "trigger", mention: "trigger", group: "wait" },
    };
  },
};

export interface WillState {
  readonly activeTurnId: string | null;
}

export interface WillEngine {
  decide(input: ChannelInput, state: WillState): Awaitable<"wait" | "trigger">;
  observe?(result: TurnResult): Awaitable<void>;
  debug?(): WillDebug | undefined;
}

export interface WillDebug {
  readonly engine: "default" | "routing" | "willingness";
  readonly config?: Record<string, unknown>;
  readonly score?: number;
  readonly probability?: number;
}

export interface WillPlugin {
  readonly priority: number;
  match(session: Session): boolean;
  matchContext?(context: ChannelContext): boolean;
  setup(context: ChannelContext): Awaitable<WillEngine>;
}
