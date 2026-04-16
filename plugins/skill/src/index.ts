import { Metadata, YesImPlugin } from "@yesimbot/plugin-sdk";
import type { InstructionProvider } from "@yesimbot/plugin-sdk";
import type { Context } from "koishi";
import { Schema } from "koishi";

import { buildSkillSummaries, resolveSkillRoots } from "./state";
import { buildSkillPluginToolDefinitions } from "./tool-definitions";

interface InstructionBlock {
  key: string;
  title: string;
  content: string;
  layer: "extension";
  priority: number;
}

export interface SkillPluginConfig {
  skills: string[];
}

@Metadata({
  name: "skill",
  description: "Skill index and runtime skill tools",
})
export default class SkillPlugin extends YesImPlugin<SkillPluginConfig> {
  static name = "skill";
  static inject = ["yesimbot.plugin"];
  static Config: Schema<SkillPluginConfig> = Schema.object({
    skills: Schema.array(Schema.path({ allowCreate: true }))
      .role("table")
      .default([]),
  });

  private readonly baseDir: string;

  constructor(ctx: Context, config: SkillPluginConfig) {
    super(ctx, config);
    this.baseDir = ctx.baseDir;
  }

  override async start(): Promise<void> {
    const definitions = await buildSkillPluginToolDefinitions({
      baseDir: this.baseDir,
      skills: this.config.skills,
    });
    for (const definition of definitions) {
      this.registerToolDefinition(definition);
    }
  }

  override getInstructions(): InstructionProvider[] {
    return [
      {
        name: "skill",
        collect: async () => {
          const skillRoots = resolveSkillRoots(this.baseDir, this.config.skills);
          const summaries = await buildSkillSummaries(skillRoots);
          if (summaries.length === 0) {
            return [];
          }

          const lines = ["The following skills are available in this runtime:", ""];
          for (const summary of summaries) {
            lines.push(`- **${summary.name}** — ${summary.description}`);
          }

          lines.push("");
          lines.push(
            "Use the `skill`, `skill_read`, or `skill_search` tools to inspect full skill content.",
          );

          return [
            {
              key: "available-skills",
              title: "Available Skills",
              content: lines.join("\n"),
              layer: "extension",
              priority: 60,
            },
          ] as unknown[];
        },
      },
    ];
  }
}

export type { SkillRecord, SkillSummary } from "./state";
