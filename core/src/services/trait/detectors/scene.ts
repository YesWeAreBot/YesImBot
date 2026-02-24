import type { Context, Logger } from "koishi";

import type { HorizonView } from "../../horizon/types";
import type { Scope, TraitSignal } from "../../shared/types";
import type { TraitAnalyzer } from "../service";
import type { TraitDetector } from "../types";

interface SceneState {
  lastBotResponseAt?: number;
  messagesSinceBotResponse: number;
  lastMentionedAt?: number;
  messagesSinceMention: number;
}

const IGNORED_MESSAGES_SINCE_RESPONSE = 5;
const IGNORED_MESSAGES_SINCE_MENTION = 10;

function channelKey(scope: Scope): string {
  return `${scope.platform}:${scope.channelId}`;
}

export class SceneTrait implements TraitDetector {
  name = "scene";
  private analyzer!: TraitAnalyzer;
  private botName?: string;
  private logger!: Logger;

  start(ctx: unknown, analyzer: unknown): void {
    const context = ctx as Context;
    this.analyzer = analyzer as TraitAnalyzer;
    this.logger = context.logger("trait:scene");

    context.on("horizon/message", (event) => {
      const key = channelKey(event.scope);
      const state = this.analyzer.getState<SceneState>(this.name, key) ?? {
        messagesSinceBotResponse: 0,
        messagesSinceMention: 0,
      };

      state.messagesSinceBotResponse++;
      state.messagesSinceMention++;

      if (
        this.botName &&
        event.payload.content.toLowerCase().includes(this.botName.toLowerCase())
      ) {
        state.lastMentionedAt = Date.now();
        state.messagesSinceMention = 0;
      }

      this.analyzer.setState(this.name, key, state);
    });
  }

  detect(scope: Scope, view: HorizonView): TraitSignal[] {
    // Lazy-init bot name from view
    if (!this.botName && view.self?.name) {
      this.botName = view.self.name;
    }

    const signals: TraitSignal[] = [];
    const key = channelKey(scope);

    // Scene dimension — prefer stage:"new" messages as trigger content
    const msgs = view.history?.filter((o) => o.type === "message") ?? [];
    const triggerMsg = msgs.filter((o) => o.stage === "new").slice(-1)[0] ?? msgs.slice(-1)[0];
    signals.push({
      dimension: "scene",
      value: scope.isDirect ? "private-chat" : "group-chat",
      confidence: 1.0,
      ...(triggerMsg && { metadata: { triggerContent: triggerMsg.content } }),
    });

    // Attention dimension
    const state = this.analyzer.getState<SceneState>(this.name, key);

    // Check mentioned: scan recent history for bot name
    let mentioned = false;
    if (this.botName && view.history) {
      const name = this.botName.toLowerCase();
      const recent = view.history.slice(-5);
      for (const obs of recent) {
        if (obs.type === "message" && obs.content.toLowerCase().includes(name)) {
          mentioned = true;
          break;
        }
      }
    }

    if (mentioned) {
      signals.push({
        dimension: "attention",
        value: "mentioned",
        confidence: 0.9,
      });
    } else if (state) {
      const ignoredByResponse =
        state.lastBotResponseAt !== undefined &&
        state.messagesSinceBotResponse >= IGNORED_MESSAGES_SINCE_RESPONSE;
      const ignoredByMention = state.messagesSinceMention >= IGNORED_MESSAGES_SINCE_MENTION;

      if (ignoredByResponse || ignoredByMention) {
        signals.push({
          dimension: "attention",
          value: "ignored",
          confidence: 0.8,
        });
      }
    }

    return signals;
  }
}
