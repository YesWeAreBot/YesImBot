import { Context, Logger, Service, type Session } from "koishi";

declare module "koishi" {
  interface Context {
    "yesimbot.bot": AthenaBotService;
  }
}

export interface AthenaBotServiceConfig {
  logLevel?: number;
  consumeMessages?: boolean;
}

export class AthenaBotService extends Service<AthenaBotServiceConfig> {
  static inject = [];
  private static readonly NON_MESSAGE_EVENTS = [
    "message-deleted",
    "reaction-added",
    "reaction-removed",
    "guild-member-added",
    "guild-member-removed",
  ] as const;

  readonly logger: Logger;
  private sessionHandler?: (session: Session) => Promise<void>;
  private disposeMiddleware?: () => void;
  private disposeEventHandlers: Array<() => void> = [];

  constructor(
    public ctx: Context,
    public config: AthenaBotServiceConfig,
  ) {
    super(ctx, "yesimbot.bot");
    this.logger = ctx.logger("yesimbot.bot");
    this.logger.level = config.logLevel ?? 2;
  }

  async start(): Promise<void> {
    this.disposeMiddleware = this.ctx.middleware(async (session, next) => {
      await this.sessionHandler?.(session);
      if (this.config.consumeMessages) return;
      return next();
    }, true);

    this.disposeEventHandlers = AthenaBotService.NON_MESSAGE_EVENTS.map((eventName) =>
      this.ctx.on(eventName, async (session) => {
        await this.sessionHandler?.(session);
      }),
    );
  }

  stop(): void {
    this.disposeMiddleware?.();
    this.disposeMiddleware = undefined;
    for (const dispose of this.disposeEventHandlers) {
      dispose();
    }
    this.disposeEventHandlers = [];
    this.clearSessionHandler();
  }

  setSessionHandler(handler: (session: Session) => Promise<void>): void {
    this.sessionHandler = handler;
  }

  clearSessionHandler(): void {
    this.sessionHandler = undefined;
  }
}
