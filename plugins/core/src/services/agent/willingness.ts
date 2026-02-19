import { parseModelId } from "@yesimbot/shared-model";
import { generateText } from "ai";

import type { UserMessagePercept } from "../horizon/types";
import type { ModelService } from "../model/service";
import type { AgentCoreConfig } from "./config";

interface CooldownState {
  lastReplyAt: number;
  messagesSinceReply: number;
}

export class WillingnessCalculator {
  private cooldowns = new Map<string, CooldownState>();

  async shouldReply(
    percept: UserMessagePercept,
    config: AgentCoreConfig,
    modelService: ModelService,
  ): Promise<boolean> {
    const key = `${percept.scope.platform}:${percept.scope.channelId}`;
    if (percept.triggerType === "mention" || percept.triggerType === "reply") return true;
    if (this.isInHardCooldown(key, config)) return false;
    const score = this.computeScore(percept, key, config);
    if (score < (config.willingnessRejectThreshold ?? 0.15)) return false;
    if (score >= (config.willingnessAcceptThreshold ?? 0.75)) return true;
    return this.llmJudge(percept, config, modelService);
  }

  private computeScore(percept: UserMessagePercept, key: string, config: AgentCoreConfig): number {
    const weights: Record<string, number> = { direct: 0.9, keyword: 0.6, random: 0.2 };
    let score = weights[percept.triggerType] ?? 0.2;
    const state = this.cooldowns.get(key);
    if (state) {
      const elapsed = Date.now() - state.lastReplyAt;
      const decayFactor = Math.min(1, elapsed / (config.willingSoftDecayMs ?? 300000));
      score *= 0.5 + 0.5 * decayFactor;
    }
    return Math.max(0, Math.min(1, score));
  }

  private isInHardCooldown(key: string, config: AgentCoreConfig): boolean {
    const state = this.cooldowns.get(key);
    if (!state) return false;
    const msgOk = state.messagesSinceReply >= (config.willingCooldownMessages ?? 3);
    const timeOk = Date.now() - state.lastReplyAt >= (config.willingCooldownMs ?? 60000);
    return !(msgOk && timeOk);
  }

  private async llmJudge(
    percept: UserMessagePercept,
    config: AgentCoreConfig,
    modelService: ModelService,
  ): Promise<boolean> {
    const fullId = config.willingnessModel ?? config.model;
    if (!fullId) return false;
    try {
      const { model, defaultParams } = modelService.getModel(fullId);
      const { text } = await generateText({
        ...defaultParams,
        model,
        system: "You decide if a chatbot should reply to this message. Answer only 'yes' or 'no'.",
        prompt: `Message: "${percept.payload.content}"\nTrigger: ${percept.triggerType}\nShould the bot reply?`,
        maxOutputTokens: 5,
      });
      return text.trim().toLowerCase().startsWith("yes");
    } catch {
      return false;
    }
  }

  recordReply(key: string): void {
    this.cooldowns.set(key, { lastReplyAt: Date.now(), messagesSinceReply: 0 });
  }

  incrementMessageCount(key: string): void {
    const state = this.cooldowns.get(key);
    if (state) state.messagesSinceReply++;
  }
}
