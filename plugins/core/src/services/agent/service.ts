import { Context, Service } from "koishi";

import type { Percept, UserMessagePercept } from "../horizon/types";
import type { ModelService } from "../model/service";
import type { AgentCoreConfig } from "./config";
import { ThinkActLoop } from "./loop";
import { WillingnessCalculator } from "./willingness";

declare module "koishi" {
  interface Context {
    "yesimbot.agent": AgentCore;
  }
}

export class AgentCore extends Service<AgentCoreConfig> {
  static inject = ["yesimbot.horizon", "yesimbot.plugin", "yesimbot.prompt", "yesimbot.model"];

  private queues = new Map<string, Promise<void>>();
  private pending = new Map<string, Percept>();
  private loop!: ThinkActLoop;
  private willingness = new WillingnessCalculator();

  constructor(ctx: Context, config: AgentCoreConfig) {
    super(ctx, "yesimbot.agent", false);
    this.config = config;
    this.logger = ctx.logger("agent");
  }

  protected async start(): Promise<void> {
    this.loop = new ThinkActLoop(this.ctx);
    this.ctx.on("horizon/percept", (percept) => this.handlePercept(percept));
    this.logger.info("AgentCore started");
  }

  private handlePercept(percept: Percept): void {
    void this.gateAndEnqueue(percept);
  }

  private async gateAndEnqueue(percept: Percept): Promise<void> {
    try {
      const channelKey = `${percept.scope.platform}:${percept.scope.channelId}`;
      this.willingness.incrementMessageCount(channelKey);
      const modelService = this.ctx["yesimbot.model"] as ModelService;
      const allowed = await this.willingness.shouldReply(
        percept as UserMessagePercept,
        this.config,
        modelService,
      );
      if (!allowed) return;
      if (this.queues.has(channelKey)) {
        this.pending.set(channelKey, percept);
      } else {
        this.enqueue(channelKey, percept);
      }
    } catch (err: unknown) {
      this.logger.error(`gateAndEnqueue error: ${err}`);
    }
  }

  private enqueue(channelKey: string, percept: Percept): void {
    const chain = (this.queues.get(channelKey) ?? Promise.resolve())
      .then(() => this.runLoop(channelKey, percept))
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

  protected async runLoop(channelKey: string, percept: Percept): Promise<void> {
    try {
      await this.loop.run(percept, this.config);
      this.willingness.recordReply(channelKey);
    } catch (err: unknown) {
      this.logger.error(`runLoop error: ${err}`);
      this.logger.error(err);
    }
  }
}
