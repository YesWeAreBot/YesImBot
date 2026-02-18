import { Context, Schema } from "koishi";

import { Plugin } from "../base-plugin";
import { Action, Metadata, withInnerThoughts } from "../decorators";
import type { FunctionContext, ToolResult } from "../types";
import { Failed, Success } from "../utils";

@Metadata({ name: "core", description: "Core built-in tools", builtin: true })
export class CorePlugin extends Plugin {
  constructor(private ctx: Context) {
    super();
  }

  @Action({
    name: "send_message",
    description: "Send a message to the current conversation",
    parameters: withInnerThoughts({
      content: Schema.string().required().description("Message content to send"),
    }),
  })
  async sendMessage(params: Record<string, unknown>, ctx: FunctionContext): Promise<ToolResult> {
    try {
      await ctx.session?.send(String(params["content"] ?? ""));
      return Success();
    } catch (e) {
      return Failed(e instanceof Error ? e.message : String(e));
    }
  }
}
