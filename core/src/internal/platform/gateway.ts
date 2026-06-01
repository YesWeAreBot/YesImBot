import type { Bot, Context, Events, Fragment, Logger, Session } from "koishi";

import type {
  DeliveryOptions,
  DeliveryResult,
  GatewayEvent,
  PlatformAdapter,
  PlatformListener,
  RawEventInput,
} from "./types.js";

type Event = keyof Events<Context>;

export class PlatformGateway {
  private readonly logger: Logger;
  private readonly ctx: Context;
  private readonly adapters = new Map<string, PlatformAdapter>();
  private readonly listenersBySource = new Map<string, PlatformListener[]>();
  private readonly sourceDisposers = new Map<string, () => void>();
  private eventSubscriber?: (event: GatewayEvent) => Promise<void>;
  private started = false;

  constructor(ctx: Context) {
    this.ctx = ctx;
    this.logger = ctx.logger("yesimbot.platform");
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  async start(): Promise<void> {
    this.started = true;
    for (const sourceKey of this.listenersBySource.keys()) {
      this.ensureSourceListener(sourceKey);
    }
  }

  stop(): void {
    this.started = false;
    for (const dispose of this.sourceDisposers.values()) dispose();
    this.sourceDisposers.clear();
    this.eventSubscriber = undefined;
  }

  // ==========================================================================
  // Registration
  // ==========================================================================

  registerAdapter(adapter: PlatformAdapter): () => void {
    this.adapters.set(adapter.platform, adapter);
    return () => {
      if (this.adapters.get(adapter.platform) === adapter) {
        this.adapters.delete(adapter.platform);
      }
    };
  }

  registerListener(listener: PlatformListener): () => void {
    const sourceKey = sourceToKey(listener.source);
    const list = this.listenersBySource.get(sourceKey) ?? [];
    list.push(listener);
    list.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    this.listenersBySource.set(sourceKey, list);

    if (this.started) {
      this.ensureSourceListener(sourceKey);
    }

    return () => {
      const filtered = (this.listenersBySource.get(sourceKey) ?? []).filter((l) => l !== listener);
      if (filtered.length === 0) {
        this.listenersBySource.delete(sourceKey);
        this.disposeSourceListener(sourceKey);
      } else {
        this.listenersBySource.set(sourceKey, filtered);
      }
    };
  }

  // ==========================================================================
  // Event subscription
  // ==========================================================================

  subscribe(subscriber: (event: GatewayEvent) => Promise<void>): () => void {
    if (this.eventSubscriber) {
      throw new Error("PlatformGateway already has an event subscriber");
    }
    this.eventSubscriber = subscriber;
    return () => {
      if (this.eventSubscriber === subscriber) {
        this.eventSubscriber = undefined;
      }
    };
  }

  // ==========================================================================
  // Send (Egress)
  // ==========================================================================

  async send(
    bot: Bot,
    channelId: string,
    segments: Fragment[],
    options?: DeliveryOptions,
  ): Promise<DeliveryResult> {
    const adapter = bot.platform ? this.adapters.get(bot.platform) : undefined;

    if (adapter) {
      return adapter.deliver(bot, channelId, segments, options);
    }

    // Fallback: 通用 Koishi 发送
    const delivered: string[] = [];
    const failed: string[] = [];

    try {
      for (const segment of segments) {
        await bot.sendMessage(channelId, segment);
        delivered.push(String(segment));
      }
      return { ok: true, deliveredSegments: delivered, failedSegments: [] };
    } catch (err: unknown) {
      return {
        ok: false,
        deliveredSegments: delivered,
        failedSegments: segments.map(String),
        issue: {
          kind: "send_failed",
          timestamp: Date.now(),
          reason: (err as Error)?.message ?? String(err),
          failedSegments: segments.map(String),
        },
      };
    }
  }

  // ==========================================================================
  // Private: source listener management
  // ==========================================================================

  private ensureSourceListener(sourceKey: string): void {
    if (this.sourceDisposers.has(sourceKey)) return;

    if (sourceKey === "middleware") {
      const dispose = this.ctx.middleware(async (session: Session, next) => {
        const consumed = await this.handleSourceInput(sourceKey, {
          session,
          args: [session],
          selfId: session.bot?.selfId,
        });
        if (consumed) return;
        return next();
      });
      this.sourceDisposers.set(sourceKey, dispose);
    } else {
      const eventName = sourceKey.replace("koishi-event:", "");
      const dispose = this.ctx.on(eventName as Event, async (...args: unknown[]) => {
        const session = findSession(args);
        await this.handleSourceInput(sourceKey, {
          session,
          args,
          selfId: session?.bot?.selfId,
        });
      });
      this.sourceDisposers.set(sourceKey, dispose);
    }
  }

  private disposeSourceListener(sourceKey: string): void {
    const dispose = this.sourceDisposers.get(sourceKey);
    dispose?.();
    this.sourceDisposers.delete(sourceKey);
  }

  private async handleSourceInput(sourceKey: string, input: RawEventInput): Promise<boolean> {
    const listeners = this.listenersBySource.get(sourceKey) ?? [];
    for (const listener of listeners) {
      try {
        const result = await listener.translate(input);
        if (result.type === "pass") continue;
        if (result.type === "drop") return true;

        if (result.type === "event" && this.eventSubscriber) {
          const bot = resolveBot(input, this.ctx);
          if (!bot) {
            this.logger.warn(`No bot available for event ${result.event.type}`);
            return true;
          }
          const content = listener.renderContent(result.event.payload);
          await this.eventSubscriber({
            event: result.event,
            content,
            bot,
            originSession: input.session,
          });
          return true;
        }
      } catch (err: unknown) {
        this.logger.error(
          `Listener "${listener.name}" error:`,
          (err as Error)?.message ?? String(err),
        );
      }
    }
    return false;
  }
}

// ============================================================================
// Helpers
// ============================================================================

function sourceToKey(
  source: { kind: "middleware" } | { kind: "koishi-event"; eventName: string },
): string {
  return source.kind === "middleware" ? "middleware" : `koishi-event:${source.eventName}`;
}

function findSession(args: unknown[]): Session | undefined {
  return args.find(
    (arg): arg is Session =>
      typeof arg === "object" &&
      arg !== null &&
      "platform" in arg &&
      "channelId" in arg &&
      "bot" in arg,
  );
}

function resolveBot(
  input: RawEventInput,
  ctx: { bots?: Iterable<Bot> & Record<string, Bot | undefined> },
): Bot | undefined {
  // 1. session.bot
  const sessionBot = input.session?.bot as Bot | undefined;
  if (sessionBot) return sessionBot;

  // 2. ctx.bots 中查找
  const bots = ctx.bots;
  if (!bots) return undefined;

  const platform = input.session?.platform as string | undefined;
  if (!platform) return undefined;

  // 找到一个匹配 platform 的 bot
  if (typeof bots[Symbol.iterator] === "function") {
    for (const bot of bots) {
      if (bot.platform === platform) return bot;
    }
  }

  return undefined;
}
