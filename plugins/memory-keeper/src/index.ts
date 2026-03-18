import fs from "fs/promises";
import path from "path";

import { Context, Schema } from "koishi";
import {
  Metadata,
  Tool,
  ToolExecutionContext,
  YesImPlugin,
} from "koishi-plugin-yesimbot/services/plugin";
import { loadSkillsFromDir } from "koishi-plugin-yesimbot/services/skill";

interface MemoryKeeperConfig {
  memoryDir: string;
}

const builtinSkillsDir = path.join(__dirname, "../", "resources/skills");

@Metadata({
  name: "memory-keeper",
  description: "一个简单的记忆管理插件，提供长期记忆的存储和检索功能，支持个人和群组作用域。",
})
export default class MemoryKeeper extends YesImPlugin {
  static name = "memory-keeper";
  static inject = ["yesimbot.plugin", "yesimbot.skill", "yesimbot.hook"];
  static Config: Schema<MemoryKeeperConfig> = Schema.object({
    memoryDir: Schema.string().description("存储记忆的目录").default("./data/memories"),
  });

  private dataDir: string;
  private disposeSkills: (() => void)[] = [];

  constructor(
    ctx: Context,
    private config: MemoryKeeperConfig,
  ) {
    super(ctx);
    this.dataDir = path.resolve(this.ctx.baseDir, this.config.memoryDir);

    this.initDir();
    const skills = loadSkillsFromDir(builtinSkillsDir);
    this.disposeSkills = skills.map((s) => this.ctx["yesimbot.skill"].register(s));
    this.ctx.on("dispose", async () => this.dispose());
  }

  private async initDir() {
    await fs.mkdir(path.join(this.dataDir, "users"), { recursive: true });
    await fs.mkdir(path.join(this.dataDir, "groups"), { recursive: true });
  }

  private normalize(str: string): string {
    return str.replace(/[^a-z0-9_-]/gi, "_").toLowerCase();
  }

  /**
   * 核心辅助方法：获取标准化路径并确保作用域安全
   */
  private getMemoryPath(ctx: ToolExecutionContext, scope: string, topic: string) {
    const isPrivate = scope === "private" || ctx.session?.isDirect;
    const folderType = isPrivate ? "users" : "groups";

    // 私有记忆使用 userId，群组记忆使用 channelId
    const id = isPrivate ? ctx.session?.userId : ctx.session?.channelId;

    if (!id) throw new Error("无法确定会话 ID");

    const folderPath = path.join(this.dataDir, folderType, this.normalize(id));
    const filePath = path.join(folderPath, `${this.normalize(topic)}.md`);

    return { folderPath, filePath, isPrivate, id };
  }

  @Tool({
    name: "remember",
    description: "完全覆盖或创建一段长期记忆。适用于更新整个主题的内容。",
    parameters: Schema.object({
      topic: Schema.string().description("记忆主题，如 'user_bio'"),
      content: Schema.string().description("Markdown 格式的完整内容"),
      scope: Schema.union(["private", "group"]).default("group").description("存储域"),
    }),
  })
  private async remember(
    params: { topic: string; content: string; scope: string },
    ctx: ToolExecutionContext,
  ) {
    try {
      const { folderPath, filePath, isPrivate } = this.getMemoryPath(
        ctx,
        params.scope,
        params.topic,
      );
      await fs.mkdir(folderPath, { recursive: true });
      await fs.writeFile(filePath, params.content, "utf-8");
      return {
        status: "success",
        content: `已更新${isPrivate ? "个人" : "群组"}记忆: ${params.topic}`,
      };
    } catch (e) {
      return { status: "error", content: `存储失败: ${(e as Error).message}` };
    }
  }

  @Tool({
    name: "appendMemory",
    description: "在现有记忆末尾追加新信息，不会覆盖旧内容。推荐用于记录事件、日志或新发现。",
    parameters: Schema.object({
      topic: Schema.string().description("记忆主题"),
      newInsight: Schema.string().description("要追加的新信息"),
      scope: Schema.union(["private", "group"]).default("group").description("存储域"),
    }),
  })
  private async appendMemory(
    params: { topic: string; newInsight: string; scope: string },
    ctx: ToolExecutionContext,
  ) {
    try {
      const { folderPath, filePath } = this.getMemoryPath(ctx, params.scope, params.topic);
      await fs.mkdir(folderPath, { recursive: true });
      const timestamp = new Date().toLocaleString();
      const entry = `\n- [${timestamp}]: ${params.newInsight}`;
      await fs.appendFile(filePath, entry, "utf-8");
      return { status: "success", content: `已追加到 ${params.topic}` };
    } catch (e) {
      return { status: "error", content: `追加失败: ${(e as Error).message}` };
    }
  }

  @Tool({
    name: "recall",
    description: "读取特定主题的记忆。如果不确定主题名，请先调用 listMemories。",
    parameters: Schema.object({
      topic: Schema.string().description("记忆主题名称"),
    }),
  })
  private async recall(params: { topic: string }, ctx: ToolExecutionContext) {
    // 尝试读取个人和群组两个作用域
    const results = [];
    const scopes = ["private", "group"];

    for (const scope of scopes) {
      try {
        const { filePath } = this.getMemoryPath(ctx, scope, params.topic);
        const content = await fs.readFile(filePath, "utf-8");
        results.push(`--- ${scope.toUpperCase()} MEMORY (${params.topic}) ---\n${content}`);
      } catch (e) {
        // 忽略不存在的文件
      }
    }

    return results.length > 0
      ? results.join("\n\n")
      : `未找到关于 "${params.topic}" 的记忆。你可以尝试 listMemories 查看可用主题。`;
  }

  @Tool({
    name: "listMemories",
    description: "列出你可以访问的所有记忆主题（包含个人隐私和当前群组）。",
    parameters: Schema.object({}),
  })
  private async listMemories(_params: {}, ctx: ToolExecutionContext) {
    const list = async (scope: "private" | "group") => {
      try {
        const { folderPath } = this.getMemoryPath(ctx, scope, "placeholder");
        const files = await fs.readdir(folderPath);
        return files.filter((f) => f.endsWith(".md")).map((f) => f.replace(".md", ""));
      } catch {
        return [];
      }
    };

    const privateTopics = await list("private");
    const groupTopics = await list("group");

    return {
      private_memories: privateTopics,
      group_memories: groupTopics,
      instruction: "使用 recall 工具并指定主题名来读取详细内容。",
    };
  }

  private async dispose(): Promise<void> {
    this.disposeSkills.forEach((d) => d());
  }
}
