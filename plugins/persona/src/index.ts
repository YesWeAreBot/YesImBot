import { Context, Schema } from "koishi";

import enUS from "./locales/en-US.json";
import zhCN from "./locales/zh-CN.json";
import { PRESETS } from "./presets";
import type { PersonaFields, PresetKey } from "./presets";

interface InjectionEntry {
  name: string;
  renderFn: (scope: Record<string, unknown>) => string | Promise<string>;
  before?: string;
  after?: string;
}

interface PromptInjector {
  inject(ctx: Context, point: string, entry: InjectionEntry): () => void;
}

declare module "koishi" {
  interface Context {
    "yesimbot.prompt": PromptInjector;
  }
}

export const name = "yesimbot-persona";
export const inject = ["yesimbot.prompt"];

export { PRESETS, type PersonaFields, type PresetKey } from "./presets";

export interface Config extends PersonaFields {
  preset: PresetKey;
}

export const Config: Schema<Config> = Schema.object({
  preset: Schema.union([
    Schema.const("none").description({ "zh-CN": "无预设", "en-US": "None" } as never),
    Schema.const("friendly").description({ "zh-CN": "活泼友好", "en-US": "Friendly" } as never),
    Schema.const("professional").description({
      "zh-CN": "专业沉稳",
      "en-US": "Professional",
    } as never),
  ]).default("none"),
  name: Schema.string().default(""),
  personality: Schema.string().default(""),
  tone: Schema.string().default(""),
  extra: Schema.string().role("textarea").default(""),
})
  .description({ "zh-CN": "人设配置", "en-US": "Persona" } as never)
  .i18n({ "zh-CN": zhCN._config, "en-US": enUS._config });

const FIELD_LABELS: ReadonlyArray<{ key: keyof PersonaFields; label: string }> = [
  { key: "name", label: "名字" },
  { key: "personality", label: "核心性格" },
  { key: "tone", label: "语气风格" },
];

const SEMANTIC_PREFIX = "以下是补充人格特质：";

export function buildPersonaText(config: Config): string {
  const preset = PRESETS[config.preset] ?? PRESETS.none;

  const merged: PersonaFields = {
    name: config.name || preset.name,
    personality: config.personality || preset.personality,
    tone: config.tone || preset.tone,
    extra: config.extra || preset.extra,
  };

  const lines: string[] = [];

  for (const { key, label } of FIELD_LABELS) {
    if (merged[key]) lines.push(`${label}：${merged[key]}`);
  }

  if (merged.extra) lines.push(merged.extra);

  if (lines.length === 0) return "";

  return `${SEMANTIC_PREFIX}\n${lines.join("\n")}`;
}

export function apply(ctx: Context, config: Config) {
  const text = buildPersonaText(config);
  if (!text) return;

  ctx["yesimbot.prompt"].inject(ctx, "soul", {
    name: "__persona_supplement",
    after: "__role_soul",
    renderFn: () => text,
  });
}
