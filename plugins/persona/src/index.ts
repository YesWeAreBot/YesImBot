import { Context, Schema } from "koishi";

import enUS from "./locales/en-US.json";
import zhCN from "./locales/zh-CN.json";
import type { PersonaFields, PresetKey } from "./presets";

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

export function apply(_ctx: Context, _config: Config) {
  // Prompt injection logic will be implemented in Plan 02
}
