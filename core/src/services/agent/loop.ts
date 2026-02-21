import { type StepResult, type ToolSet } from "ai";
import { Context, sleep } from "koishi";

import type { HorizonService } from "../horizon/service";
import type { CallParams, ModelService } from "../model/service";
import type { PluginService } from "../plugin/service";
import type { ToolExecutionContext } from "../plugin/types";
import type { PromptService } from "../prompt/service";
import type { Percept } from "../shared/types";
import type { AgentCoreConfig } from "./service";
import { buildAiSdkTools, buildStopCondition } from "./tools";

class LoopAbort extends Error {}

export class ThinkActLoop {
  private logger;

  constructor(
    private ctx: Context,
    private config: AgentCoreConfig,
  ) {
    this.logger = ctx.logger("agent");
  }

  async run(percept: Percept, toolCtx: ToolExecutionContext): Promise<void> {
    this.logger.info(`Starting loop for percept ${percept.id} of type ${percept.type}`);
    const loopStartTime = Date.now();

    const horizon = this.ctx["yesimbot.horizon"] as HorizonService;
    const pluginService = this.ctx["yesimbot.plugin"] as PluginService;
    const prompt = this.ctx["yesimbot.prompt"] as PromptService;
    const modelService = this.ctx["yesimbot.model"] as ModelService;

    const view = await horizon.buildView(percept.scope, {
      session: toolCtx.session,
      selfId: toolCtx.bot?.selfId,
      selfName: toolCtx.bot?.user?.name,
    });

    const systemPrompt = await prompt.renderToString("system", { view, percept });

    const userContent = horizon.formatHorizonText(view);

    const toolCtxWithPercept = { ...toolCtx, percept };
    const { tools: allTools, toolNames: infoToolNames } = buildAiSdkTools(
      pluginService,
      toolCtxWithPercept,
      this.config.maxToolResultLength ?? 4000,
    );
    this.logger.info(`Available tools: [${Object.keys(allTools).join(", ")}]`);
    const messages = [{ role: "user" as const, content: userContent }];
    const stopWhen = buildStopCondition(this.config.maxRounds ?? 3);

    // ModelService handles model resolution and default params internally
    const collectedSteps: StepResult<ToolSet>[] = [];
    let fallbackText = "";

    const timeoutMs = this.config.globalTimeout ?? 120000;
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Global loop timeout")), timeoutMs),
    );

    const onStepFinish = (step: StepResult<ToolSet>) => {
      this.logger.info(
        `Step #${collectedSteps.length + 1} finished. \
        Tool calls: [${(step.toolCalls ?? []).map((t) => t.toolName).join(", ")}]. \
        ${isEmptyString(step.text) ? "" : `Text: ${step.text}`}`.trim(),
      );
      collectedSteps.push(step);
      const calls = step.toolCalls ?? [];
      if (calls.length && !calls.some((t) => infoToolNames.has(t.toolName))) {
        throw new LoopAbort();
      }
    };

    this.logger.info(JSON.stringify({ systemPrompt, messages }, null, 2));

    const callParams = {
      system: systemPrompt,
      messages,
      tools: allTools as ToolSet,
      toolChoice: "required",
      stopWhen,
      onStepFinish,
    } as CallParams;

    try {
      let resultText: string | undefined;
      if (this.config.streamMode) {
        const streamResult = await Promise.race([
          modelService.streamCall(this.config.model ?? "", callParams, this.config.fallbackChain),
          timeoutPromise,
        ]);
        resultText = await streamResult.text;
      } else {
        const result = await Promise.race([
          modelService.call(this.config.model ?? "", callParams, this.config.fallbackChain),
          timeoutPromise,
        ]);
        resultText = result?.text;
      }

      if (resultText) {
        this.logger.info(`Model output: ${resultText}`);
        fallbackText = resultText;
        if (fallbackText.indexOf("</think>") >= 0) {
          fallbackText = fallbackText.split("</think>").slice(-1)[0];
        }
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
      const elapsed = Date.now() - loopStartTime;
      const typingMs = Math.min(fallbackText.trim().length * 50, 3000);
      const delay = Math.max(0, typingMs - elapsed);
      if (delay > 0) await sleep(delay);
      await toolCtx.session?.send(fallbackText.trim());
    }

    const sentContent = hasSent
      ? collectedSteps
          .flatMap((s) => (s.toolCalls ?? []).filter((t) => t.toolName === "send_message"))
          .map((t) => String((t.input as Record<string, unknown>)?.["content"] ?? ""))
          .join(" ")
      : fallbackText.trim();

    await horizon.events.markAsActive(percept.scope, new Date());
    const archiveMs =
      (this.ctx["yesimbot.horizon"] as HorizonService).config.archiveThresholdMs ?? 86400000;
    await horizon.events.archiveStale(percept.scope, archiveMs);

    const summary = `Tools: [${toolNames.join(", ")}]. Sent: [${sentContent || "nothing"}]`;
    await horizon.events.recordAgentSummary({
      scope: percept.scope,
      timestamp: new Date(),
      summary,
    });
    this.logger.info(`Loop complete: ${collectedSteps.length} steps`);
  }
}

function isEmptyString(str: unknown): boolean {
  return typeof str === "string" && str.trim() === "";
}
