import { Context, Service } from "koishi";

import type { Percept } from "../horizon/types";
import type { AgentCoreConfig } from "./config";

declare module "koishi" {
  interface Context {
    "yesimbot.agent": AgentCore;
  }
}

export class AgentCore extends Service<AgentCoreConfig> {
  static inject = ["yesimbot.horizon", "yesimbot.plugin", "yesimbot.prompt", "model-service"];

  private queues = new Map<string, Promise<void>>();
  private pending = new Map<string, Percept>();

  constructor(ctx: Context, config: AgentCoreConfig) {
    super(ctx, "yesimbot.agent", false);
  }

  protected async start(): Promise<void> {
    this.ctx.on("horizon/percept", (percept) => this.handlePercept(percept));
    this.logger.info("AgentCore started");
  }

  private handlePercept(percept: Percept): void {
    const channelKey = `${percept.scope.platform}:${percept.scope.channelId}`;
    if (this.queues.has(channelKey)) {
      this.pending.set(channelKey, percept);
    } else {
      this.enqueue(channelKey, percept);
    }
  }

  private enqueue(channelKey: string, percept: Percept): void {
    const chain = (this.queues.get(channelKey) ?? Promise.resolve())
      .then(() => this.runLoop(percept))
      .then(() => {
        const next = this.pending.get(channelKey);
        if (next) {
          this.pending.delete(channelKey);
          this.enqueue(channelKey, next);
        }
      })
      .catch((err: unknown) => this.logger.error(`AgentCore queue error: ${err}`))
      .finally(() => {
        if (this.queues.get(channelKey) === chain) this.queues.delete(channelKey);
      });
    this.queues.set(channelKey, chain);
  }

  protected async runLoop(percept: Percept): Promise<void> {
    const channelKey = `${percept.scope.platform}:${percept.scope.channelId}`;
    this.logger.info(`runLoop called for ${channelKey}`);
  }
}
