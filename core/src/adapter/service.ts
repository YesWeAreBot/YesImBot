import { Context, Service } from "koishi";

import { GenericAdapter } from "./generic.js";
import type { AthenaEvent, PlatformAdapter } from "./types.js";

declare module "koishi" {
  interface Context {
    "yesimbot.adapter": AdapterService;
  }
  interface Events {
    "athena/event"(event: AthenaEvent): void;
  }
}

export interface AdapterConfig {
  logLevel?: number;
}

export class AdapterService extends Service<AdapterConfig> {
  static inject = [];

  private _adapters = new Map<string, PlatformAdapter>();

  constructor(ctx: Context, config: AdapterConfig) {
    super(ctx, "yesimbot.adapter");
    this.config = config;
    this.logger = ctx.logger("AdapterService");
    this.logger.level = config.logLevel ?? 2;
  }

  protected async start() {
    this.register(new GenericAdapter(this.ctx, {}));
  }

  register(adapter: PlatformAdapter): () => void {
    if (this._adapters.has(adapter.platform)) {
      throw new Error(`Adapter for platform "${adapter.platform}" is already registered`);
    }

    this._adapters.set(adapter.platform, adapter);

    const emit = (event: AthenaEvent) => {
      this.ctx.emit("athena/event", event);
    };
    adapter.install(emit);

    return () => {
      this._adapters.delete(adapter.platform);
    };
  }

  get(platform: string): PlatformAdapter | undefined {
    return this._adapters.get(platform);
  }
}
