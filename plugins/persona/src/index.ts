import { Context, Schema } from "koishi";
import type { PromptFragment, PromptService } from "koishi-plugin-yesimbot/services/prompt";

declare module "koishi" {
  interface Context {
    "yesimbot.prompt": PromptService;
  }
}

type LegacyPromptInjector = (ctx: Context, section: string, options: LegacyPromptOptions) => void;

interface LegacyPromptOptions {
  name: string;
  after?: string;
  renderFn: () => string;
}

interface LegacyCompatiblePromptService extends PromptService {
  inject?: LegacyPromptInjector;
}

export const name = "yesimbot-persona";
export const inject = ["yesimbot.prompt"] as const;

export interface Config {
  name: string;
  personality: string;
  tone: string;
  extra: string;
}

export const Config: Schema<Config> = Schema.object({
  name: Schema.string().default("").description("Override display name hint for the persona."),
  personality: Schema.string()
    .default("")
    .description("Core personality traits the model should embody."),
  tone: Schema.string().default("").description("Speaking tone and style guidance."),
  extra: Schema.string()
    .role("textarea", { rows: [4, 8] })
    .default("")
    .description("Additional free-form persona notes or examples."),
});

const SEMANTIC_PREFIX =
  "Additional persona details. Treat these as a supplement to the main identity instructions.";

function normalizeField(value: string): string {
  return value.trim();
}

function buildPersonaFragment(content: string): PromptFragment {
  return {
    id: "persona.supplement",
    section: "identity",
    source: "hook",
    stability: "stable",
    priority: 695,
    cacheable: true,
    content: ["<persona_supplement>", content, "</persona_supplement>"].join("\n"),
  };
}

export function buildPersonaText(config: Config): string {
  const resolvedName = normalizeField(config.name);
  const resolvedPersonality = normalizeField(config.personality);
  const resolvedTone = normalizeField(config.tone);
  const resolvedExtra = normalizeField(config.extra);

  const lines: string[] = [];
  if (resolvedName) lines.push(`name: ${resolvedName}`);
  if (resolvedPersonality) lines.push(`personality: ${resolvedPersonality}`);
  if (resolvedTone) lines.push(`tone: ${resolvedTone}`);
  if (resolvedExtra) lines.push(`extra:\n${resolvedExtra}`);

  if (lines.length === 0) return "";
  return [SEMANTIC_PREFIX, ...lines].join("\n");
}

export function apply(ctx: Context, config: Config): void {
  const text = buildPersonaText(config);
  if (!text) return;

  const prompt = ctx["yesimbot.prompt"] as LegacyCompatiblePromptService;
  if (typeof prompt.registerFragmentSource === "function") {
    const dispose = prompt.registerFragmentSource("persona", async (): Promise<PromptFragment[]> => [
      buildPersonaFragment(text),
    ]);
    ctx.on("dispose", () => dispose());
    return;
  }

  if (typeof prompt.inject === "function") {
    prompt.inject(ctx, "soul", {
      name: "__persona_supplement",
      after: "__role_soul",
      renderFn: () => text,
    });
    return;
  }

  throw new TypeError("yesimbot.prompt does not expose registerFragmentSource() or inject().");
}
