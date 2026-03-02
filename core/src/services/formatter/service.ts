import { Context, Service } from "koishi";
import type { Element, Session } from "koishi";

import { type ElementHandler, registerBuiltinHandlers } from "./handlers";

declare module "koishi" {
  interface Context {
    "yesimbot.formatter": FormatterService;
  }
}

export class FormatterService extends Service {
  private handlers = new Map<string, ElementHandler>();

  constructor(ctx: Context) {
    super(ctx, "yesimbot.formatter", true);
    registerBuiltinHandlers(this.register.bind(this), ctx);
  }

  register(type: string, handler: ElementHandler): void {
    this.handlers.set(type, handler);
  }

  format(elements: Element[], session?: Session): string {
    return elements.map((el) => this.formatElement(el, session)).join("");
  }

  private formatElement(el: Element, _session?: Session): string {
    if (el.type === "text") {
      return el.toString();
    }
    const handler = this.handlers.get(el.type);
    if (handler) return handler(el.attrs, el.children);
    return `<unsupported type="${el.type}"/>`;
  }
}
