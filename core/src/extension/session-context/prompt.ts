import type { ChannelLocator } from "./types.js";

export function buildSessionContextPrompt(input: {
  isolation: boolean;
  currentChannel: ChannelLocator | null;
  defaultLimit: number;
  maxLimit: number;
}): string {
  const modeLabel = input.isolation ? "隔离模式" : "共享模式";
  const current = input.currentChannel
    ? `platform=${input.currentChannel.platform} channelId=${input.currentChannel.channelId}`
    : "未知";
  const channelKey = input.currentChannel?.channelKey ?? "未知";

  return `
=== 会话检索能力 ===

你可以检索持久化的 JSONL 会话日志，用于回忆历史事实、补全被压缩的上下文、跨频道回溯话题。

<当前范围>
- 模式：${modeLabel}
- 当前频道：${current}
- 当前频道 channelKey=${channelKey}
</当前范围>

<定位规则>
- 首选输入是 \`platform + channelId\`。
- \`channelKey\` 是内部目录键，由 \`encodeChannelId(platform, channelId)\` 生成；只有工具结果已经返回它时，才优先复用它。
- 不知道 \`channelKey\` 不是阻塞。共享模式下可以先发现频道，或直接做带条件的跨频道搜索。
</定位规则>

<工具>
1. \`find_channels\`
   - 用途：发现频道、按 locator 反查频道、查看最近活跃候选频道
   - 场景：你不知道 channelKey，或只知道平台 / 模糊 channelId
   - 特点：便宜，默认只读 channel-map 和 meta 信息

2. \`search_session\`
   - 用途：搜索历史消息内容
   - 常用条件：\`query\`、\`senderId\`、\`since\`、\`until\`
   - 支持范围：当前频道、指定频道、共享模式下的跨频道搜索
   - 默认只看 \`user\` 和 \`assistant\` 消息

3. \`list_sessions\`
   - 用途：列出某一个已定位频道的 session 文件
   - 注意：它不是"列全部频道"的工具

4. \`read_session_window\`
   - 用途：按 \`sessionId\` 和命中时间回读上下文窗口
   - 场景：搜索命中后，需要看前后对话，而不是只看片段
</工具>

<推荐策略>
1. 已知关键词、用户、时间范围：先用 \`search_session\`
2. 不知道目标频道，但知道平台、频道号或只想看最近候选频道：先用 \`find_channels\`
3. 已经定位到频道，才用 \`list_sessions\`
4. 已拿到 \`sessionId\` 或命中时间，需要回溯上下文，才用 \`read_session_window\`

不要因为不知道 \`channelKey\` 就放弃检索。${
    input.isolation
      ? ""
      : `
不要先用 \`list_sessions\` 做全量枚举。
不要在没有收窄条件时做跨频道大范围扫描。`
  }
</推荐策略>

<隔离与共享规则>
- 隔离模式：只能访问当前频道。任何其他频道 locator 或全局搜索都应视为不可用。
- 共享模式：允许发现频道和跨频道搜索。
- 共享模式下，\`search_session(scope="global")\` 必须至少提供一种收窄条件：\`query\`、\`senderId\`、\`senderQuery\`、\`since\`、\`until\`。
</隔离与共享规则>

<噪声过滤与截断>
- 检索结果会过滤 \`tool-call\`、\`tool-result\`、\`session_info\`、畸形 JSON、空文本助手消息。
- 搜索结果中的 \`content\` 是片段，不保证完整原文；长文本会被截断。
- 若需要上下文，不要猜测原文，改用 \`read_session_window\`。
</噪声过滤与截断>

<可追溯性限制>
- 片段结果只可用于定位，不可当作完整会话转录。
- 可信定位信息是：\`platform\`、\`channelId\`、\`channelKey\`、\`sessionId\`、\`timestamp\`。
- 需要复盘某段对话时，应基于这些定位信息再次读取窗口，而不是凭摘要扩写。
</可追溯性限制>

<失败时的处理>
- 没有结果：优先改写查询条件或缩小时间范围
- 频道未定位：先用 \`find_channels\`
- 命中太多：先加 \`since/until\`、\`senderId\` 或更具体的 \`query\`
- 隔离模式越权：停止跨频道尝试，改查当前频道
</失败时的处理>
`;
}
