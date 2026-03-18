import type { PromptFragment } from "../prompt/types";
import { specificity } from "./condition";
import { LoadedSkillSet } from "./loaded-skill-set";
import { normalizePromptMetadata, normalizeStyleMetadata } from "./normalize";
import type { AppliedSkillEffects } from "./types";

interface CandidateStyleFragment {
  fragment: PromptFragment;
  specificity: number;
}

export class SkillEffectApplier {
  apply(loadedSkills: LoadedSkillSet): AppliedSkillEffects {
    const promptFragments: PromptFragment[] = [];
    const toolVisibility = { include: [] as string[], exclude: [] as string[] };

    let bestStyle: CandidateStyleFragment | null = null;

    for (const skill of loadedSkills.getLoaded()) {
      if (skill.effects.prompt) {
        const promptMeta = normalizePromptMetadata(skill);
        promptFragments.push({
          id: `skill.${skill.name}.prompt`,
          content: `<skill name="${skill.name}">${skill.effects.prompt}</skill>`,
          section: promptMeta.section,
          source: "skill",
          priority: promptMeta.priority,
          stability: promptMeta.stability,
          cacheable: promptMeta.cacheable,
        });
      }

      if (skill.effects.style?.content) {
        const styleMeta = normalizeStyleMetadata(skill);
        const styleSpecificity = skill.conditions ? specificity(skill.conditions) : 0;
        if (!bestStyle || styleSpecificity >= bestStyle.specificity) {
          bestStyle = {
            specificity: styleSpecificity,
            fragment: {
              id: `skill.${skill.name}.style`,
              content: skill.effects.style.content,
              section: styleMeta.section,
              source: "skill",
              priority: styleMeta.priority,
              stability: styleMeta.stability,
              cacheable: styleMeta.cacheable,
            },
          };
        }
      }

      if (skill.effects.tools?.include) {
        toolVisibility.include.push(...skill.effects.tools.include);
      }

      if (skill.effects.tools?.exclude) {
        toolVisibility.exclude.push(...skill.effects.tools.exclude);
      }
    }

    return {
      promptFragments,
      styleFragment: bestStyle?.fragment ?? null,
      toolVisibility,
      metadata: {
        loadedSkills: loadedSkills.getLoadedNames(),
        loadHistory: loadedSkills.getLoadHistory(),
      },
    };
  }
}

export type { AppliedSkillEffects };
