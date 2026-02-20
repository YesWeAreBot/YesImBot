import { Plugin } from "../base-plugin";
import { Metadata, Tool, withInnerThoughts } from "../decorators";
import type { FunctionContext, ToolResult } from "../types";
import { Success } from "../utils";

@Metadata({ name: "session-info", description: "Session information tools" })
export class SessionInfoPlugin extends Plugin {
  @Tool({
    name: "get_session_info",
    description: "Get information about the current chat session",
    parameters: withInnerThoughts({}),
  })
  async getSessionInfo(
    _params: Record<string, unknown>,
    ctx: FunctionContext,
  ): Promise<ToolResult> {
    const s = ctx.session;
    return Success({
      platform: s?.platform,
      channelId: s?.channelId,
      guildId: s?.guildId,
      userId: s?.userId,
      username: s?.username,
      isDirect: s?.isDirect,
    });
  }
}
