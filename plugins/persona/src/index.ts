import { Context, Schema } from "koishi";
import type {} from "koishi-plugin-yesimbot/services/prompt";

import enUS from "./locales/en-US.json";
import zhCN from "./locales/zh-CN.json";

export const name = "yesimbot-persona";
export const inject = ["yesimbot.prompt"];

export interface Config {
  name: string;
  personality: string;
  tone: string;
  extra: string;
}

export const Config: Schema<Config> = Schema.object({
  name: Schema.string().default(""),
  personality: Schema.string().default(""),
  tone: Schema.string().default(""),
  extra: Schema.string().role("textarea").default(""),
}).i18n({ "zh-CN": zhCN._config, "en-US": enUS._config });

const SEMANTIC_PREFIX = "以下是补充人格特质：";

export function buildPersonaText(config: Config): string {
  const lines: string[] = [];
  if (config.name) lines.push(`name：${config.name}`);
  if (config.personality) lines.push(`personality：${config.personality}`);
  if (config.tone) lines.push(`tone：${config.tone}`);
  if (config.extra) lines.push(`extra：${config.extra}`);
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
