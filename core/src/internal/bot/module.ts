import { Bot, type Context, type Logger, type Session } from "koishi";

import { createCoreFallbackObservers } from "./events.js";
import type {
  EventObserver,
  ObservedEvent,
  ObserverInput,
  ObserverSource,
} from "./observer-types.js";
import {
  createDefaultChatMessagePresenter,
  createDefaultMemberChangePresenter,
  createDefaultMessageRecallPresenter,
  createDefaultReactionPresenter,
  createPresenterCatalog,
  type PresenterCatalog,
} from "./presentation.js";
import type { AthenaEvent } from "./types.js";

export interface BotModuleConfig {
  logLevel?: number;
  consumeMessages?: boolean;
}

export interface BotModuleDeps {
  ctx: Context;
  config: BotModuleConfig;
}

export class BotModule {
  readonly logger: Logger;
  private readonly ctx: Context;
  private readonly config: BotModuleConfig;
  private readonly observers = new Map<string, EventObserver>();
  private readonly observersBySource = new Map<string, EventObserver[]>();
  private readonly sourceDisposers = new Map<string, () => void>();
  private readonly presenterCatalog: PresenterCatalog = createPresenterCatalog();
  private readonly observerPresenterDisposers = new Map<string, Array<() => void>>();
  private disposeMiddleware?: () => void;
  private observedEventSubscriber?: (observed: ObservedEvent) => Promise<void>;
  private started = false;
  private coreFallbackRegistered = false;

  constructor(deps: BotModuleDeps) {
    this.ctx = deps.ctx;
    this.config = deps.config;
    this.logger = deps.ctx.logger("yesimbot.bot");
    this.logger.level = deps.config.logLevel ?? 2;
    this.presenterCatalog.registerBase("chat_message", createDefaultChatMessagePresenter());
    this.presenterCatalog.registerBase("message_recall", createDefaultMessageRecallPresenter());
    this.presenterCatalog.registerBase("reaction", createDefaultReactionPresenter());
    this.presenterCatalog.registerBase("member_change", createDefaultMemberChangePresenter());
  }

  async start(): Promise<void> {
    this.registerCoreFallbackObservers();
    this.started = true;
    for (const observers of this.observersBySource.values()) {
      const first = observers[0];
      if (first) this.ensureSourceListener(first.source);
    }
  }

  stop(): void {
    this.started = false;
    for (const sourceKey of [...this.sourceDisposers.keys()]) {
      this.disposeSourceListener(sourceKey);
    }
    this.observedEventSubscriber = undefined;
  }

  registerObserver(observer: EventObserver): () => void {
    if (this.observers.has(observer.name)) {
      throw new Error(`Event observer "${observer.name}" is already registered`);
    }
    if (observer.eventKinds.length === 0) {
      throw new Error(`Event observer "${observer.name}" must declare at least one event kind`);
    }
    validateObserverSource(observer);

    const presenterDisposers: Array<() => void> = [];

    try {
      for (const [kind, presenter] of Object.entries(observer.presenters ?? {})) {
        presenterDisposers.push(
          this.presenterCatalog.registerBase(kind as never, presenter as never),
        );
      }
    } catch (error) {
      for (const dispose of presenterDisposers) dispose();
      throw error;
    }

    for (const kind of observer.eventKinds) {
      if (!this.presenterCatalog.has(kind)) {
        for (const dispose of presenterDisposers) dispose();
        throw new Error(
          `Event observer "${observer.name}" declares event kind "${String(kind)}" without presenter coverage`,
        );
      }
    }

    if (presenterDisposers.length > 0) {
      this.observerPresenterDisposers.set(observer.name, presenterDisposers);
    }

    this.observers.set(observer.name, observer);
    this.addObserverToSource(observer);

    if (this.started) {
      this.ensureSourceListener(observer.source);
    }

    return () => this.unregisterObserver(observer.name);
  }

  unregisterObserver(name: string): void {
    const observer = this.observers.get(name);
    if (!observer) return;

    this.observers.delete(name);
    const sourceKey = getSourceKey(observer.source);
    const remaining = (this.observersBySource.get(sourceKey) ?? []).filter(
      (candidate) => candidate.name !== name,
    );

    if (remaining.length === 0) {
      this.observersBySource.delete(sourceKey);
      this.disposeSourceListener(sourceKey);
    } else {
      this.observersBySource.set(sourceKey, sortObservers(remaining));
    }

    const presenterDisposers = this.observerPresenterDisposers.get(name) ?? [];
    for (const dispose of presenterDisposers) {
      dispose();
    }
    this.observerPresenterDisposers.delete(name);
  }

  subscribeObservedEvents(subscriber: (observed: ObservedEvent) => Promise<void>): () => void {
    if (this.observedEventSubscriber) {
      throw new Error("BotModule already has an observed-event subscriber");
    }

    this.observedEventSubscriber = subscriber;

    return () => {
      if (this.observedEventSubscriber === subscriber) {
        this.observedEventSubscriber = undefined;
      }
    };
  }

  getPresenterCatalog(): PresenterCatalog {
    return this.presenterCatalog;
  }

  private registerCoreFallbackObservers(): void {
    if (this.coreFallbackRegistered) return;
    for (const observer of createCoreFallbackObservers()) {
      this.registerObserver(observer);
    }
    this.coreFallbackRegistered = true;
  }

  private addObserverToSource(observer: EventObserver): void {
    const sourceKey = getSourceKey(observer.source);
    const existing = this.observersBySource.get(sourceKey) ?? [];
    this.observersBySource.set(sourceKey, sortObservers([...existing, observer]));
  }

  private ensureSourceListener(source: ObserverSource): void {
    const sourceKey = getSourceKey(source);
    if (this.sourceDisposers.has(sourceKey)) return;

    if (source.kind === "middleware") {
      this.disposeMiddleware = this.ctx.middleware(async (session, next) => {
        await this.handleSourceInput({
          source,
          session,
          selfId: session.bot?.selfId,
          args: [session],
        });

        if (this.config.consumeMessages) return;
        return next();
      }, true);
      this.sourceDisposers.set(sourceKey, () => {
        this.disposeMiddleware?.();
        this.disposeMiddleware = undefined;
      });
      return;
    }

    const subscribe = this.ctx.on as (
      event: string,
      listener: (...args: unknown[]) => void | Promise<void>,
    ) => () => void;
    const dispose = subscribe(source.eventName, async (...args: unknown[]) => {
      const session = findSession(args);
      await this.handleSourceInput({
        source,
        eventName: source.eventName,
        session,
        selfId: session?.bot?.selfId,
        args,
      });
    });
    this.sourceDisposers.set(sourceKey, dispose);
  }

  private disposeSourceListener(sourceKey: string): void {
    const dispose = this.sourceDisposers.get(sourceKey);
    if (!dispose) return;
    dispose();
    this.sourceDisposers.delete(sourceKey);
  }

  private async handleSourceInput(input: ObserverInput): Promise<void> {
    const sourceKey = getSourceKey(input.source);
    const observers = this.observersBySource.get(sourceKey) ?? [];

    for (const observer of observers) {
      let result;
      try {
        result = await observer.handle(input);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Event observer "${observer.name}" failed for source "${sourceKey}": ${message}`,
        );
        return;
      }

      this.logger.debug(
        `Event observer "${observer.name}" returned "${result.type}" for source "${sourceKey}"`,
      );

      if (result.type === "pass") continue;
      if (result.type === "drop") return;

      await this.publishObservedEvent(result.event, input);
      return;
    }
  }

  private async publishObservedEvent(event: AthenaEvent, input: ObserverInput): Promise<void> {
    if (!this.observedEventSubscriber) return;

    const { platform, channelId } = event.source;
    const sessionBot = input.session?.bot;
    const sessionSelfId = sessionBot?.selfId;

    if (sessionSelfId && event.source.selfId && event.source.selfId !== sessionSelfId) {
      this.logger.debug(
        `Ignored observer-provided selfId "${event.source.selfId}" for Session-backed event in ${platform}:${channelId}`,
      );
    }

    const observedSelfId = sessionSelfId ?? event.source.selfId ?? input.selfId;
    const bot = this.resolveBot(platform, observedSelfId, sessionBot);
    if (!bot) {
      this.logger.warn(`No Koishi bot available for observed event ${platform}:${channelId}`);
      return;
    }

    const resolvedSelfId = observedSelfId ?? bot.selfId;
    if (event.source.selfId !== resolvedSelfId) {
      event.source.selfId = resolvedSelfId;
    }

    try {
      await this.observedEventSubscriber({
        event,
        bot,
        originSession: input.session,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Observed event subscriber failed for ${event.source.platform}:${event.source.channelId}: ${message}`,
      );
    }
  }

  private resolveBot(platform: string, selfId?: string, sessionBot?: Bot): Bot | undefined {
    if (sessionBot) {
      return sessionBot;
    }

    const bots = this.ctx.bots as BotCollection | undefined;
    if (!bots) return undefined;

    if (selfId) {
      return bots[`${platform}:${selfId}`] ?? findBotCandidate(bots, platform, selfId);
    }

    const candidates = findBotCandidates(bots, platform);

    if (candidates.length === 1) {
      return candidates[0];
    }

    if (candidates.length > 1) {
      this.logger.warn(`Ambiguous Koishi bot for platform "${platform}"`);
    }

    return undefined;
  }
}

function getSourceKey(source: ObserverSource): string {
  return source.kind === "middleware" ? "middleware" : `koishi-event:${source.eventName}`;
}

function validateObserverSource(observer: EventObserver): void {
  if (observer.source.kind === "middleware") return;
  if (
    observer.source.kind === "koishi-event" &&
    typeof observer.source.eventName === "string" &&
    observer.source.eventName.trim()
  ) {
    return;
  }

  throw new Error(`Event observer "${observer.name}" has an invalid source`);
}

function sortObservers(observers: EventObserver[]): EventObserver[] {
  return [...observers].sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
}

type BotCollection = Iterable<Bot> & Record<string, Bot | undefined>;

function findBotCandidate(bots: BotCollection, platform: string, selfId: string): Bot | undefined {
  return findBotCandidates(bots, platform).find((bot) => bot.selfId === selfId);
}

function findBotCandidates(bots: BotCollection, platform: string): Array<Bot> {
  const candidates = new Map<string, Bot>();

  if (typeof bots[Symbol.iterator] === "function") {
    for (const bot of bots) {
      addBotCandidate(candidates, platform, bot);
    }
  }

  for (const [key, bot] of Object.entries(bots)) {
    if (key.startsWith(`${platform}:`)) {
      addBotCandidate(candidates, platform, bot);
    }
  }

  return [...candidates.values()];
}

function addBotCandidate(
  candidates: Map<string, Bot>,
  platform: string,
  bot: Bot | undefined,
): void {
  if (!bot || bot.platform !== platform) return;
  candidates.set(`${bot.platform}:${bot.selfId}`, bot);
}

function findSession(args: unknown[]): Session | undefined {
  return args.find((arg): arg is Session => {
    return (
      typeof arg === "object" &&
      arg !== null &&
      "platform" in arg &&
      "channelId" in arg &&
      "bot" in arg
    );
  });
}
