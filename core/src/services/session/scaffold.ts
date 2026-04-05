import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_SESSION_INSTRUCTIONS =
  "你是一个群聊参与者。像真人一样自然地参与对话，不要使用助手腔调。所有要发送到聊天中的可见内容都必须通过 send_message 工具发送；普通 assistant 文本不会直接发给用户。默认在发送后结束当前轮次，只有在确实需要继续下一步时才设置 request_heartbeat。";

export const DEFAULT_AGENTS_MARKDOWN = `# Workspace Instructions

## Heartbeat and request_heartbeat

- \`request_heartbeat=true\` 表示这个工具结束后要立刻再运行一轮模型。
- 如果这次 \`send_message\` 已经完成当前任务，就不要请求 heartbeat。省略 \`request_heartbeat\` 或显式设为 \`false\`，这样消息发送后当前轮次就会结束并交还控制权。
- 只有在你已经明确知道发送后还要立刻执行下一步时，才设置 \`request_heartbeat=true\`，例如紧接着还要调用另一个工具，或还要再发送一条跟进消息。
- 不要为了“继续想一想”而请求 heartbeat。普通的一次性回复通常应该是一条 \`send_message\`，且不请求 heartbeat。
`;

function writeTextIfMissing(filePath: string, content: string): void {
  if (existsSync(filePath)) {
    return;
  }

  writeFileSync(filePath, content, "utf8");
}

function copyTextFileIfMissing(sourcePath: string, targetPath: string): void {
  if (existsSync(targetPath) || !existsSync(sourcePath)) {
    return;
  }

  copyFileSync(sourcePath, targetPath);
}

export function ensureGlobalScaffold(globalRoot: string): void {
  mkdirSync(globalRoot, { recursive: true });

  writeTextIfMissing(join(globalRoot, "SOUL.md"), `${DEFAULT_SESSION_INSTRUCTIONS}\n`);
  writeTextIfMissing(join(globalRoot, "AGENTS.md"), DEFAULT_AGENTS_MARKDOWN);
}

export function ensureWorkspaceScaffold(channelDir: string, globalRoot: string): void {
  const workspaceDir = join(channelDir, "workspace");
  mkdirSync(workspaceDir, { recursive: true });

  copyTextFileIfMissing(join(globalRoot, "SOUL.md"), join(workspaceDir, "SOUL.md"));
  copyTextFileIfMissing(join(globalRoot, "AGENTS.md"), join(workspaceDir, "AGENTS.md"));
}

export function hasExistingWorkspace(channelDir: string): boolean {
  return existsSync(join(channelDir, "workspace"));
}
