import type { ChannelSummary, SearchContext, ToolError } from "../types.js";
import { listChannelSummaries, toolError } from "../channel-store.js";

const DEFAULT_MAX_CHANNELS = 10;

export class ChannelResolver {
  constructor(private ctx: SearchContext) {}

  async resolve(
    where: "here" | "all",
    options?: { maxChannels?: number },
  ): Promise<ChannelSummary[] | ToolError> {
    if (where === "here") {
      if (!this.ctx.currentChannel) {
        return toolError(
          "当前频道上下文不可用。",
          "CURRENT_CHANNEL_REQUIRED",
          "请在频道绑定的会话中使用。",
        );
      }
      return [
        {
          ...this.ctx.currentChannel,
          type: undefined,
          currentSessionId: undefined,
          sessionCount: undefined,
          lastActiveAt: undefined,
        },
      ];
    }

    // where === "all"
    if (this.ctx.isolation) {
      return toolError(
        "隔离模式下无法跨频道搜索。",
        "ISOLATION_VIOLATION",
        "请使用 where=\"here\" 搜索当前频道。",
      );
    }

    const allChannels = await listChannelSummaries(this.ctx.sessionsDir);
    const maxChannels = options?.maxChannels ?? DEFAULT_MAX_CHANNELS;

    allChannels.sort((a, b) => {
      const ta = a.lastActiveAt ? new Date(a.lastActiveAt).getTime() : 0;
      const tb = b.lastActiveAt ? new Date(b.lastActiveAt).getTime() : 0;
      return tb - ta;
    });

    return allChannels.slice(0, maxChannels);
  }
}
