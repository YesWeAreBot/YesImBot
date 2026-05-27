import { readFileSync } from "fs";
import { resolve } from "path";

import { jsonSchema } from "@yesimbot/agent/ai";
import { Context, Logger, Schema } from "koishi";
import type { ExtensionContext } from "koishi-plugin-yesimbot";

import { formatSkillsForPrompt, loadSkills, Skill } from "./skills";

type LoadSkillToolInput = {
  skill: string;
  args?: Record<string, unknown>;
};

type LoadSkillToolOutput =
  | {
      path: string;
      content: string;
    }
  | {
      error: string;
    };

export interface SkillConfig {
  skillPaths: string[];
}

export default class SkillPlugin {
  static name = "yesimbot-skill";
  static inject = ["yesimbot.extension"];
  static Config: Schema<SkillConfig> = Schema.object({
    skillPaths: Schema.array(Schema.path({ filters: ["directory", "file"], allowCreate: true }))
      .default([])
      .description("技能文件路径列表"),
  });

  public readonly ctx: Context;
  public readonly config: SkillConfig;
  public readonly logger: Logger;

  private skills: Skill[] = [];
  constructor(ctx: Context, config: SkillConfig) {
    this.ctx = ctx;
    this.config = config;
    this.logger = ctx.logger("yesimbot.skill");
    const skillPaths = config.skillPaths.map((path) => resolve(ctx.baseDir, path));
    const loadResult = loadSkills({ skillPaths: skillPaths, cwd: ctx.baseDir });

    for (const diagnostic of loadResult.diagnostics) {
      if (diagnostic.type === "error") {
        this.logger.error(
          `加载技能时发生错误: ${diagnostic.message} ${diagnostic.path ? `(路径: ${diagnostic.path})` : ""}`,
        );
      } else if (diagnostic.type === "warning") {
        this.logger.warn(
          `加载技能时发生警告: ${diagnostic.message} ${diagnostic.path ? `(路径: ${diagnostic.path})` : ""}`,
        );
      } else if (diagnostic.type === "collision") {
        this.logger.warn(
          `资源冲突: ${diagnostic.message} 资源类型: ${diagnostic.collision?.resourceType} 资源名称: ${diagnostic.collision?.name} 胜者路径: ${diagnostic.collision?.winnerPath} 败者路径: ${diagnostic.collision?.loserPath}`,
        );
      }
    }
    for (const skill of loadResult.skills) {
      this.skills.push(skill);
      this.logger.info(`成功加载技能: ${skill.name} (${skill.filePath})`);
    }

    ctx.on("ready", this.start.bind(this));
    ctx.on("dispose", this.stop.bind(this));
  }

  async start(): Promise<void> {
    const skills = this.skills;
    const logger = this.logger;
    await this.ctx["yesimbot.extension"].registerExtension({
      id: "skill",
      setup(ctx: ExtensionContext) {
        ctx.on("agent:before-start", (event) => {
          logger.info(`正在准备技能，已加载 ${skills.length} 个技能`);
          const skillPrompt = formatSkillsForPrompt(skills);

          return {
            systemPrompt: event.systemPrompt + skillPrompt,
          };
        });
        ctx.tool.register<LoadSkillToolInput, LoadSkillToolOutput>({
          name: "load_skill",
          description: "加载技能",
          promptSnippet: "技能名称：{skillName}",
          promptGuidelines: ["输入技能名称，返回技能内容"],
          inputSchema: jsonSchema({
            type: "object",
            properties: {
              skill: {
                type: "string",
                description: 'The skill name. E.g., "commit", "review-pr", or "pdf"',
              },
              args: {
                type: "string",
                description: "Optional arguments for the skill",
              },
            },
            required: ["skill"],
          }),
          execute: async ({ skill: skillName, args: _args }, _options) => {
            const skill = skills.find((s) => s.name === skillName);
            if (!skill) {
              return {
                error: `未找到技能: ${skillName}`,
              };
            }
            const content = readFileSync(skill.filePath, "utf-8");
            return {
              path: skill.filePath,
              content: content,
            };
          },
        });
      },
    });
  }

  async stop(): Promise<void> {
    await this.ctx["yesimbot.extension"].unregisterExtension("skill");
  }
}
