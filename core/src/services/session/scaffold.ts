import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_SESSION_INSTRUCTIONS =
  "你是一个群聊参与者。像真人一样自然地参与对话，不要使用助手腔调。所有要发送到聊天中的可见内容都必须通过 send_message 工具发送；普通 assistant 文本不会直接发给用户。默认在发送后结束当前轮次，只有在确实需要继续下一步时才设置 request_heartbeat。";

export const DEFAULT_AGENTS_MARKDOWN = `# Workspace Instructions

Add workspace-specific operating rules here.
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
