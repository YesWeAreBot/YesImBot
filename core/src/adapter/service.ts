import { Context, Service } from "koishi";

import { createFormatterRegistry } from "./formatter.js";
import { GenericAdapter } from "./generic.js";
import type { AthenaEvent, EventFormatter, FormatterRegistry, PlatformAdapter } from "./types.js";

declare module "koishi" {
  interface Context {
    "yesimbot.adapter": AdapterServiceImpl;
  }
  interface Events {
    "athena/event"(event: AthenaEvent): void;
  }
}

export class AdapterServiceImpl extends Service {
  static inject = [];

  private _adapters = new Map<string, PlatformAdapter>();
  private _disposeCallbacks = new Map<string, (() => void)[]>();
  private _genericAdapter?: GenericAdapter;
  readonly formatters: FormatterRegistry;

  constructor(ctx: Context) {
    super(ctx, "yesimbot.adapter");
    this.formatters = createFormatterRegistry();
  }

  protected async start() {
    this._genericAdapter = new GenericAdapter();
    this.register(this._genericAdapter);
  }

  register(adapter: PlatformAdapter): () => void {
    if (this._adapters.has(adapter.platform)) {
      throw new Error(`Adapter for platform "${adapter.platform}" is already registered`);
    }

    this._adapters.set(adapter.platform, adapter);
    const disposeCallbacks: (() => void)[] = [];

    // If registering a dedicated adapter, tell GenericAdapter to skip that platform
    if (adapter.platform !== "*" && this._genericAdapter) {
      this._genericAdapter.addSkipPlatform(adapter.platform);
      disposeCallbacks.push(() => this._genericAdapter!.removeSkipPlatform(adapter.platform));
    }

    // Register formatters
    if (adapter.formatters) {
      for (const [kind, formatter] of Object.entries(adapter.formatters)) {
        const dispose = this.formatters.register(kind, formatter as EventFormatter);
        disposeCallbacks.push(dispose);
      }
    }

    // Call install with a bound emit function
    const emit = (event: AthenaEvent) => {
      this.ctx.emit("athena/event", event);
    };
    adapter.install(this.ctx, emit);

    this._disposeCallbacks.set(adapter.platform, disposeCallbacks);

    return () => {
      this._adapters.delete(adapter.platform);
      for (const dispose of disposeCallbacks) dispose();
      this._disposeCallbacks.delete(adapter.platform);
    };
  }

  get(platform: string): PlatformAdapter | undefined {
    return this._adapters.get(platform);
  }
}
