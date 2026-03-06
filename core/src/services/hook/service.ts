import { randomUUID } from "crypto";

import { Context, Service } from "koishi";

import type { HookDefinition, HookType, HookPhase } from "./types";

interface RegisteredHook extends HookDefinition {
  ctx: Context;
}

export class HookService extends Service {
  static inject = [];

  private hooks = new Map<string, RegisteredHook>();

  constructor(ctx: Context) {
    super(ctx, "hook", true);
  }

  register(ctx: Context, def: HookDefinition): () => void {
    const hookId = def.id || randomUUID();
    const registered: RegisteredHook = { ...def, id: hookId, ctx };

    this.hooks.set(hookId, registered);

    ctx.on("dispose", () => {
      this.hooks.delete(hookId);
    });

    return () => this.hooks.delete(hookId);
  }

  getHooks(type: HookType, phase: HookPhase): RegisteredHook[] {
    return Array.from(this.hooks.values()).filter((h) => h.type === type && h.phase === phase);
  }
}
