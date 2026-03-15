import { Context, Service } from "koishi";
import type { Element, Session } from "koishi";

import { type ElementHandler, registerBuiltinHandlers } from "./handlers";

declare module "koishi" {
  interface Context {
    "yesimbot.formatter": FormatterService;
  }
}

export class FormatterService extends Service {
  static inject = ["yesimbot.image-cache"];

  private handlers = new Map<string, ElementHandler>();

  constructor(ctx: Context) {
    super(ctx, "yesimbot.formatter", true);
    registerBuiltinHandlers(this.register.bind(this), ctx);
  }

  register(type: string, handler: ElementHandler): void {
    this.handlers.set(type, handler);
  }

  async format(elements: Element[], session?: Session): Promise<string> {
    const parts: string[] = [];
    for (const el of elements) {
      parts.push(await this.formatElement(el, session));
    }
    return parts.join("");
  }

  private async formatElement(el: Element, _session?: Session): Promise<string> {
    if (el.type === "text") {
      return el.toString();
    }
    const handler = this.handlers.get(el.type);
    if (handler) return await handler(el.attrs, el.children);
    return `<unsupported type="${el.type}"/>`;
  }
}
