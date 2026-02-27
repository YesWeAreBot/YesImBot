import { Context, Schema } from "koishi";

import { requirePlatform, requireSession } from "../../activators";
import { Plugin } from "../../base-plugin";
import { Action, Metadata, withInnerThoughts } from "../../decorators";
import type { ToolExecutionContext, ToolResult } from "../../types";
import { Failed, Success } from "../../utils";
import { ForwordMessageResponse, Message } from "./types";

declare module "koishi" {
  interface Session {
    onebot: {
      _request<T>(action: string, params: Record<string, unknown>): Promise<T>;
    };
  }
}

@Metadata({ name: "onebot", description: "Onebot built-in tools", builtin: true })
export class OnebotPlugin extends Plugin {
  constructor(private ctx: Context) {
    super();
  }

  @Action({
    name: "get_forward_msg",
    description: "Get a forwarded message",
    parameters: withInnerThoughts({
      message_id: Schema.string().required().description("Message ID to retrieve"),
    }),
    activators: [requireSession(), requirePlatform("onebot")],
    hidden: true,
  })
  async getForwardMessage(
    params: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): Promise<ToolResult> {
    try {
      const messageId = String(params["message_id"] ?? "");
      const session = ctx.session;
      if (!session) return Failed("No active session");
      if (!messageId) return Failed("message_id is required");
      const response: ForwordMessageResponse = await session.onebot._request("get_forward_msg", {
        message_id: messageId,
      });
      const messages = response.data.messages;
      return Success(await formatForwardMessage(messages));
    } catch (e) {
      return Failed(e instanceof Error ? e.message : String(e));
    }
  }
}

async function formatForwardMessage(messages: Message[]): Promise<string> {
  try {
    const formattedMessages = await Promise.all(
      messages.map(async (msg) => {
        const senderInfo = `Sender: ${msg.sender.nickname} (ID: ${msg.sender.user_id})\n`;
        const timeInfo = `Time: ${new Date(msg.time * 1000).toLocaleString()}\n`;
        const contentInfo = `Content: ${msg.raw_message}\n`;
        return senderInfo + timeInfo + contentInfo;
      }),
    );
    return formattedMessages.join("\n---\n");
  } catch (e) {
    return `Failed to format messages: ${e instanceof Error ? e.message : String(e)}`;
  }
}
