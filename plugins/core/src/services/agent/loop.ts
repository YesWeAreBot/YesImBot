import type { CallSettings, Prompt } from "ai";
import { Context } from "koishi";

import type { HorizonService } from "../horizon/service";
import type { Percept, UserMessagePercept } from "../horizon/types";
import { PerceptType } from "../horizon/types";
import type { ModelService } from "../model/service";
import type { PluginService } from "../plugin/service";
import type { PromptService } from "../prompt/service";
import type { AgentCoreConfig } from "./config";
import { buildAiSdkTools, buildStopCondition, finishTool } from "./tools";

type CallParams = CallSettings & Prompt;

export class ThinkActLoop {
  private logger;

  constructor(private ctx: Context) {
    this.logger = ctx.logger("agent");
  }

  async run(percept: Percept, config: AgentCoreConfig): Promise<void> {
    if (percept.type !== PerceptType.UserMessage) {
      this.logger.warn(`Ignoring non-UserMessage percept: ${percept.type}`);
      return;
    }
    const userPercept = percept as UserMessagePercept;

    const horizon = this.ctx["yesimbot.horizon"] as HorizonService;
    const pluginService = this.ctx["yesimbot.plugin"] as PluginService;
    const prompt = this.ctx["yesimbot.prompt"] as PromptService;
    const modelService = this.ctx["model-service"] as ModelService;

    const view = await horizon.buildView(userPercept);
    const systemPrompt = await prompt.render("system", { view });
    const contextText = horizon.formatHorizonText(view);

    const fnCtx = { session: userPercept.runtime?.session, view, percept: userPercept };
    const allTools = {
      ...buildAiSdkTools(pluginService, fnCtx, config.maxToolResultLength ?? 4000),
      finish: finishTool,
    };
    const messages = [{ role: "user" as const, content: contextText }];
    const stopWhen = buildStopCondition(config.maxRounds ?? 3);

    const agentParams = {
      system: systemPrompt,
      messages,
      tools: allTools,
      toolChoice: "required" as const,
      stopWhen,
    } as CallParams;

    const timeoutMs = config.globalTimeout ?? 120000;
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Global loop timeout")), timeoutMs),
    );

    let steps: { toolCalls?: Array<{ toolName: string; args?: Record<string, unknown> }> }[] = [];

    if (config.streamMode) {
      const result = await Promise.race([
        modelService.streamCall(config.provider, config.model, agentParams),
        timeoutPromise,
      ]);
      await result.text;
      steps = (await result.steps) as typeof steps;
    } else {
      const result = await Promise.race([
        modelService.call(config.provider, config.model, agentParams),
        timeoutPromise,
      ]);
      steps = (result?.steps ?? []) as typeof steps;
    }

    const toolNames = steps.flatMap((s) => (s.toolCalls ?? []).map((t) => t.toolName));
    const sentContent = steps
      .flatMap((s) => (s.toolCalls ?? []).filter((t) => t.toolName === "send_message"))
      .map((t) => String(t.args?.["content"] ?? ""))
      .join(" ");

    const summary = `Tools: [${toolNames.join(", ")}]. Sent: [${sentContent || "nothing"}]`;
    await horizon.events.recordAgentSummary({
      scope: userPercept.scope,
      timestamp: new Date(),
      summary,
    });
    this.logger.info(`Loop complete: ${steps.length} steps`);
  }
}
