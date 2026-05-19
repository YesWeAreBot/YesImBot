import type { ChannelLocator } from "./types.js";

interface PromptContext {
  isolation: boolean;
  currentChannel: ChannelLocator | null;
}

export function buildChatHistoryPrompt(ctx: PromptContext): string {
  const mode = ctx.isolation ? "隔离模式" : "共享模式";
  const channelLabel = ctx.currentChannel
    ? `${ctx.currentChannel.platform}:${ctx.currentChannel.channelId}`
    : "未绑定";

  return `

=== 历史聊天记录检索 ===

你可以检索历史聊天记录，用于回忆过去的对话内容、查找用户说过的话、补全被压缩的上下文。

<当前范围>
- 模式：${mode}
- 当前频道：${channelLabel}
</当前范围>

<工具>
1. search_conversation — 搜索聊天记录
   - 提供 query 搜索关键词内容
   - 提供 since/until 按时间范围浏览（可无 query）
   - user 参数匹配发言者ID或昵称
   - where="here" 搜索当前频道（默认），where="all" 跨频道搜索（仅共享模式）
   - 可选按角色、时间范围过滤

2. search_user_activity — 查看某用户的活动
   - 必须提供 user（用户ID或昵称）
   - 返回该用户在各频道的近期发言摘要

3. read_conversation_context — 展开搜索结果的上下文
   - 传入搜索结果中的消息 id
   - 返回该消息前后的对话内容
   - 可通过 first_id/last_id 继续遍历
</工具>

<使用建议>
- 知道关键词 → search_conversation (query="关键词")
- 想查某个时间段的聊天 → search_conversation (since="...", until="...")
- 想查看某用户的历史消息 → search_conversation (user="用户ID或昵称")
- 想了解某人最近聊了什么 → search_user_activity
- 搜索结果需要更多上下文 → read_conversation_context
- 搜索无结果时：换关键词、扩大时间范围、或改用 where="all"
</使用建议>

<限制>
- 历史记录只能通过以上工具检索，不要尝试通过文件系统访问
- 隔离模式下无法跨频道搜索
- 过于宽泛的查询会被拒绝，请提供具体关键词或时间范围
</限制>
`;
}
