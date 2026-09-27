import type { MessageRecord, Scope } from "@/services/horizon/types";
import type { FunctionContext } from "@/services/plugin/types";

import { Schema } from "koishi";
import { TimelineEventType, TimelineStage } from "@/services/horizon/types";
import { Plugin } from "@/services/plugin/base-plugin";
import { Metadata, Tool, withInnerThoughts } from "@/services/plugin/decorators";
import { Failed, Success } from "@/services/plugin/utils";
import { Services } from "@/shared/constants";
import { formatDate, truncate } from "@/shared/utils";

/**
 * 记忆检索工具（移植自 v3-legacy memory 扩展）。
 * conversation_search：在原始对话历史（horizon 事件线）中按关键词检索。
 */
@Metadata({
    name: "memory",
    display: "记忆管理",
    description: "检索智能体的对话记忆",
    builtin: true,
})
export default class MemoryPlugin extends Plugin<Record<string, never>> {
    static readonly inject = [Services.Plugin, Services.Horizon];
    static readonly Config = Schema.object({});

    @Tool({
        name: "conversation_search",
        description:
            "在原始对话历史（回忆记忆）中按关键词检索，适合查找过去的特定关键词、人名或直接引用。基于关键词匹配，不区分大小写。",
        parameters: withInnerThoughts({
            query: Schema.string().required().description("要在历史消息中查找的关键词"),
            limit: Schema.number().min(1).max(25).default(10).description("返回的消息数量上限（默认 10，最多 25）"),
            channel_id: Schema.string().description("可选：按频道 ID 过滤"),
            user_id: Schema.string().description("可选：按发送者 ID 过滤（不含机器人自身）"),
        }),
    })
    async conversationSearch(
        params: { query: string; limit?: number; channel_id?: string; user_id?: string },
        context: FunctionContext,
    ) {
        const { query, limit = 10, channel_id, user_id } = params;
        const session = context.session;
        if (!session) {
            this.ctx.logger.warn("conversation_search: 缺少会话上下文");
            return Failed("缺少会话上下文，无法检索对话历史");
        }

        let regex: RegExp;
        try {
            regex = new RegExp(escapeRegExp(query), "i");
        } catch {
            return Failed(`检索关键词无效: ${query}`);
        }

        const horizon = this.ctx[Services.Horizon];
        const scope: Scope = {
            platform: session.platform,
            channelId: channel_id ?? session.channelId,
            guildId: session.guildId,
            isDirect: session.isDirect,
        };

        try {
            const entries = await horizon.events.query({
                scope,
                types: [TimelineEventType.Message],
                limit: 200,
                orderBy: "desc",
            });

            const matches = entries
                .filter((entry): entry is MessageRecord => entry.type === TimelineEventType.Message
                    && entry.stage !== TimelineStage.Deleted
                    && regex.test(entry.data.content)
                    && (!user_id || entry.data.senderId === user_id))
                .slice(0, limit);

            if (matches.length === 0)
                return Success("未在对话历史中找到匹配的消息。");

            const formatted = matches.map((entry) => {
                const data = entry.data;
                return `[${formatDate(entry.timestamp, "YYYY-MM-DD HH:mm")}|${data.senderName || "user"}(${data.senderId})] ${truncate(data.content, 120)}`;
            });
            return Success({
                results_count: matches.length,
                results: formatted,
            });
        } catch (error: any) {
            this.ctx.logger.error(`conversation_search 失败 | query: ${query} - ${error?.message}`);
            return Failed(`检索对话历史失败: ${error?.message ?? String(error)}`);
        }
    }
}

/** 将用户输入转义为正则字面量，避免特殊字符破坏匹配 */
function escapeRegExp(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
