import { generateText, type StepResult, type ToolSet } from "ai";
import { Context } from "koishi";

import type { HorizonService } from "../horizon/service";
import type { Percept, UserMessagePercept } from "../horizon/types";
import { PerceptType } from "../horizon/types";
import type { ModelService } from "../model/service";
import type { PluginService } from "../plugin/service";
import type { PromptService } from "../prompt/service";
import type { AgentCoreConfig } from "./config";
import { buildAiSdkTools, buildStopCondition } from "./tools";

class LoopAbort extends Error {}

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
    const modelService = this.ctx["yesimbot.model"] as ModelService;

    const view = await horizon.buildView(userPercept);
    const systemPrompt = await prompt.render("system", { view });
    const contextText = horizon.formatHorizonText(view);

    const fnCtx = { session: userPercept.runtime?.session, view, percept: userPercept };
    const { tools: allTools, toolNames: infoToolNames } = buildAiSdkTools(
      pluginService,
      fnCtx,
      config.maxToolResultLength ?? 4000,
    );
    const messages = [{ role: "user" as const, content: contextText }];
    const stopWhen = buildStopCondition(config.maxRounds ?? 3);

    // Direct generateText call for step-level control
    if (!config.provider || !config.model) {
      this.logger.warn("Missing provider or model in config");
      return;
    }
    const { model, defaultParams } = modelService.getModel(config.provider, config.model);
    const collectedSteps: StepResult<ToolSet>[] = [];
    let fallbackText = "";

    const timeoutMs = config.globalTimeout ?? 120000;
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Global loop timeout")), timeoutMs),
    );

    try {
      const result = await Promise.race([
        generateText({
          model,
          ...defaultParams,
          system: systemPrompt,
          messages,
          tools: allTools as ToolSet,
          toolChoice: "required",
          stopWhen,
          onStepFinish: (step: StepResult<ToolSet>) => {
            this.logger.info(
              `Step #${collectedSteps.length + 1} finished. Tool calls: [${(step.toolCalls ?? []).map((t) => t.toolName).join(", ")}]. ${isEmptyString(step.text) ? "" : `Text: ${step.text}`}`.trim(),
            );
            collectedSteps.push(step);
            const calls = step.toolCalls ?? [];
            if (calls.length && !calls.some((t) => infoToolNames.has(t.toolName))) {
              throw new LoopAbort();
            }
          },
        }),
        timeoutPromise,
      ]);

      if (result.text) {
        this.logger.info(`Model output: ${result.text}`);
        fallbackText = result.text;
      }
    } catch (e) {
      if (e instanceof LoopAbort) {
        this.logger.info("Loop aborted by stop condition");
      } else {
        throw e;
      }
    }

    const toolNames = collectedSteps.flatMap((s) => (s.toolCalls ?? []).map((t) => t.toolName));
    const hasSent = collectedSteps.some((s) =>
      (s.toolCalls ?? []).some((t) => t.toolName === "send_message"),
    );
    if (!hasSent && fallbackText.trim()) {
      this.logger.info("No send_message called, sending model text as fallback");
      await userPercept.runtime?.session?.send(fallbackText.trim());
    }

    const sentContent = hasSent
      ? collectedSteps
          .flatMap((s) => (s.toolCalls ?? []).filter((t) => t.toolName === "send_message"))
          .map((t) => String((t.input as Record<string, unknown>)?.["content"] ?? ""))
          .join(" ")
      : fallbackText.trim();

    const summary = `Tools: [${toolNames.join(", ")}]. Sent: [${sentContent || "nothing"}]`;
    await horizon.events.recordAgentSummary({
      scope: userPercept.scope,
      timestamp: new Date(),
      summary,
    });
    this.logger.info(`Loop complete: ${collectedSteps.length} steps`);
  }
}

function isEmptyString(str: unknown): boolean {
  return typeof str === "string" && str.trim() === "";
}
