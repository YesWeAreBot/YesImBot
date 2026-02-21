import { type StepResult, type ToolSet } from "ai";
import { Context, sleep } from "koishi";

import type { HorizonService } from "../horizon/service";
import type { Percept, UserMessagePercept } from "../horizon/types";
import { PerceptType } from "../horizon/types";
import type { CallParams, ModelService } from "../model/service";
import type { PluginService } from "../plugin/service";
import type { PromptService } from "../prompt/service";
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

  async run(percept: Percept): Promise<void> {
    this.logger.info(`Starting loop for percept ${percept.id} of type ${percept.type}`);
    if (percept.type !== PerceptType.UserMessage) {
      this.logger.warn(`Ignoring non-UserMessage percept: ${percept.type}`);
      return;
    }
    const userPercept = percept as UserMessagePercept;
    const loopStartTime = Date.now();

    const horizon = this.ctx["yesimbot.horizon"] as HorizonService;
    const pluginService = this.ctx["yesimbot.plugin"] as PluginService;
    const prompt = this.ctx["yesimbot.prompt"] as PromptService;
    const modelService = this.ctx["yesimbot.model"] as ModelService;

    const view = await horizon.buildView(userPercept);
    const structured = horizon.toStructured(view);

    // Format environment text for the prompt scope
    const envLines: string[] = [];
    if (structured.environment) {
      const e = structured.environment;
      envLines.push(`Location: ${e.name} (${e.type}${e.platform ? `, ${e.platform}` : ""})`);
    }
    if (structured.members.length) {
      envLines.push(
        `Active members: ${structured.members.map((m) => (m.badge ? `${m.name} [${m.badge}]` : m.name)).join(", ")}`,
      );
    }
    if (structured.history.length) {
      envLines.push("--- Message History ---");
      for (const h of structured.history) {
        const prefix = h.isSummary ? "[Bot Summary]" : h.isBot ? `[Bot] ${h.sender}` : h.sender;
        envLines.push(`[${h.time}] ${prefix}: ${h.content}`);
      }
    }

    const systemPrompt = await prompt.renderToString("system", {
      view,
      environment_content: envLines.join("\n"),
      has_environment: envLines.length > 0,
    });

    const fnCtx = { session: userPercept.runtime?.session, view, percept: userPercept };
    const { tools: allTools, toolNames: infoToolNames } = buildAiSdkTools(
      pluginService,
      fnCtx,
      this.config.maxToolResultLength ?? 4000,
    );
    const messages = [
      {
        role: "user" as const,
        content: `[${userPercept.triggerType}] ${userPercept.payload.content}`,
      },
    ];
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
      await userPercept.runtime?.session?.send(fallbackText.trim());
    }

    const sentContent = hasSent
      ? collectedSteps
          .flatMap((s) => (s.toolCalls ?? []).filter((t) => t.toolName === "send_message"))
          .map((t) => String((t.input as Record<string, unknown>)?.["content"] ?? ""))
          .join(" ")
      : fallbackText.trim();

    await horizon.events.markAsActive(userPercept.scope, new Date());
    const archiveMs =
      (this.ctx["yesimbot.horizon"] as HorizonService).config.archiveThresholdMs ?? 86400000;
    await horizon.events.archiveStale(userPercept.scope, archiveMs);

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
