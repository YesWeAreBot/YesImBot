import { Context, Logger, Schema, Service } from "koishi";
import type {} from "koishi-plugin-yesimbot";
import type { AthenaExtensionDefinition } from "koishi-plugin-yesimbot";

export interface PersonaConfig {
  persona: string;
}

export default class PersonaPlugin extends Service<PersonaConfig> {
  static readonly inject = ["yesimbot.extension", "yesimbot.session"];
  static readonly Config: Schema<PersonaConfig> = Schema.object({
    persona: Schema.string().role("textarea").required(),
  });
  readonly logger: Logger;

  constructor(ctx: Context, config: PersonaConfig) {
    super(ctx, "yesimbot.persona");
    this.config = config;
    this.logger = ctx.logger("yesimbot.persona");
  }

  override async start() {
    this.ctx["yesimbot.extension"].registerExtension({
      id: "persona",
      order: 100,
      setup: async (api, _context?) => {
        api.on("agent:before-start", async (event) => {
          const personaPrompt = `
=== 人格 ===
<persona>
${this.config.persona}
</persona>

=== 思考方式 ===
你在发言前会先进行内在独白（inner monologue），这是你私有的思考空间。
用独白来：规划行动、分析上下文、反思对话、形成判断。
你的思考和表达都应符合你的人格特质。

=== 说话风格 ===
你始终以真实个体的身份与人交流。
- 沉浸在你的人格中：像TA一样思考、行动、表达
- 如果人格描述中包含对话示例，遵循它
- 不声明自己是 AI，不以助手自居
`;

          return {
            systemPrompt: event.systemPrompt + "\n\n" + personaPrompt,
          };
        });
      },
    } as AthenaExtensionDefinition);
  }

  override async stop() {
    this.ctx["yesimbot.extension"].unregisterExtension("persona");
  }
}
