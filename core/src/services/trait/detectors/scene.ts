import type { Context, Logger } from "koishi";

import type { ChannelKey, Scenario } from "../../runtime/contracts";
import type { TraitSignal } from "../../shared/types";
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

function channelKey(key: ChannelKey): string {
  return `${key.platform}:${key.channelId}`;
}

export class SceneTrait implements TraitDetector {
  name = "scene";
  private analyzer!: TraitAnalyzer;
  private botName?: string;
  private logger!: Logger;

  start(ctx: Context, analyzer: unknown): void {
    this.analyzer = analyzer as TraitAnalyzer;
    this.logger = ctx.logger("trait:scene");

    ctx.on("horizon/message", (event) => {
      const key = channelKey(event);
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

  detect(key: ChannelKey, scenario: Scenario): TraitSignal[] {
    // Lazy-init bot name from scenario
    if (!this.botName && scenario.raw.self.name) {
      this.botName = scenario.raw.self.name;
    }

    const signals: TraitSignal[] = [];
    const ck = channelKey(key);
    const allMessages = scenario.raw.scenarioTimeline.turns.flatMap((turn) => turn.messages);

    // Scene dimension
    const triggerMsg = allMessages[allMessages.length - 1];
    signals.push({
      dimension: "scene",
      value: scenario.raw.environment.type === "private" ? "private-chat" : "group-chat",
      confidence: 1.0,
      ...(triggerMsg && { metadata: { triggerContent: triggerMsg.content } }),
    });

    // Attention dimension
    const state = this.analyzer.getState<SceneState>(this.name, ck);

    // Check mentioned: scan recent history for bot name
    let mentioned = false;
    if (this.botName) {
      const name = this.botName.toLowerCase();
      const recent = allMessages.slice(-5);
      for (const message of recent) {
        if (message.content.toLowerCase().includes(name)) {
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

    // Bot role signal — enables role-gated Skills (e.g. essence management)
    if (scenario.raw.self.role) {
      signals.push({
        dimension: "bot-role",
        value: scenario.raw.self.role,
        confidence: 1.0,
      });
    }

    // Forward-present signal — enables get_forward_msg tool when forwarded messages in context
    const lastTurnMessages =
      scenario.raw.scenarioTimeline.turns[scenario.raw.scenarioTimeline.turns.length - 1]
        ?.messages ?? [];
    const hasForward = lastTurnMessages.some(
      (message) => typeof message.content === "string" && message.content.includes("<forward"),
    );
    if (hasForward) {
      signals.push({
        dimension: "has-forward",
        value: "true",
        confidence: 1.0,
      });
    }

    return signals;
  }
}
