import { Context } from "koishi";

import type { HorizonService } from "../horizon/service";
import type { CallParams, ModelService } from "../model/service";
import type { PluginService } from "../plugin/service";
import { FunctionType, type ToolExecutionContext, type ToolResult } from "../plugin/types";
import type { PromptService } from "../prompt/service";
import type { Percept } from "../shared/types";
import type { SkillRegistry } from "../skill/service";
import type { SkillEffect } from "../skill/types";
import type { TraitAnalyzer } from "../trait/service";
import { JsonParser, type ParseResult } from "./json-parser";
import type { AgentCoreConfig } from "./service";
import { buildToolSchemaForPrompt } from "./tools";
import { trimMessages, type TrimConfig, type LoopMessage } from "./trimmer";

interface AgentResponse {
  thoughts?: { observe: string; analyze_infer: string; plan: string };
  actions: Array<{ name: string; params?: Record<string, unknown> }>;
  request_heartbeat?: boolean;
}

interface ToolResultEntry {
  id: number;
  name: string;
  status: string;
  result?: unknown;
  error?: string;
}

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

    const horizon = this.ctx["yesimbot.horizon"] as HorizonService;
    const pluginService = this.ctx["yesimbot.plugin"] as PluginService;
    const prompt = this.ctx["yesimbot.prompt"] as PromptService;
    const modelService = this.ctx["yesimbot.model"] as ModelService;

    const view = await horizon.buildView(percept.scope, {
      session: toolCtx.session,
      selfId: toolCtx.bot?.selfId,
      selfName: toolCtx.bot?.user?.name,
    });

    const toolCtxWithPercept = { ...toolCtx, percept };

    // Trait-Skill pipeline: analyze context, resolve active skills
    const trait = this.ctx["yesimbot.trait"] as TraitAnalyzer;
    const skill = this.ctx["yesimbot.skill"] as SkillRegistry;
    const signals = await trait.analyze(percept.scope, view);
    const effects: SkillEffect = skill.resolve(signals, percept.scope);

    const disposers: Array<() => void> = [];

    // Apply prompt injections from active skills
    for (const inj of effects.promptInjections) {
      disposers.push(
        prompt.inject(this.ctx, inj.point, {
          name: `__skill_${inj.skillName}_${percept.id}`,
          renderFn: () => inj.content,
        }),
      );
    }

    // Apply style override from highest-specificity skill
    if (effects.styleOverride) {
      disposers.push(
        prompt.inject(this.ctx, "soul", {
          name: `__skill_style_${percept.id}`,
          after: "__role_soul",
          renderFn: () => effects.styleOverride!.content,
        }),
      );
    }

    // Inject tool schema into instructions point (with skill tool filter)
    const toolSchema = buildToolSchemaForPrompt(
      pluginService,
      toolCtxWithPercept,
      effects.toolFilter,
    );
    disposers.push(
      prompt.inject(this.ctx, "instructions", {
        name: `__loop_tool_schema_${percept.id}`,
        renderFn: () => toolSchema,
      }),
    );

    try {
      const systemPrompt = await prompt.renderToString("system", { view, percept });

      const wmLines: string[] = [];
      for (const obs of view.history ?? []) {
        if (obs.type === "agent.response") {
          const d = obs.data;
          const lines = [`Round ${d.round}:`];
          for (const a of d.actions) {
            const r = d.toolResults.find((t) => t.name === a.name);
            const status = r ? r.status + (r.error ? ": " + r.error : "") : "no result";
            const preview = r?.result != null ? String(r.result).slice(0, 200) : "";
            lines.push(
              `  - ${a.name}(${JSON.stringify(a.params ?? {})}) -> ${status}${preview ? ": " + preview : ""}`,
            );
          }
          wmLines.push(lines.join("\n"));
        }
      }
      const userContent = horizon.formatHorizonText(view, wmLines);

      this.logger.info(`Available tools: ${toolSchema ? "injected" : "none"}`);

      const trimConfig: TrimConfig = {
        charBudget: this.config.charBudget ?? 30000,
        keepLastRounds: this.config.keepLastRounds ?? 2,
        softTrimHead: this.config.softTrimHead ?? 800,
        softTrimTail: this.config.softTrimTail ?? 800,
      };

      const messages: LoopMessage[] = [{ role: "user", content: userContent }];

      const maxRounds = this.config.maxRounds ?? 3;
      const maxResultLen = this.config.maxToolResultLength ?? 4000;
      let round = 0;

      const parser = new JsonParser<AgentResponse>(this.logger);

      while (round < maxRounds) {
        round++;
        this.logger.info(`Round ${round}/${maxRounds}`);

        trimMessages(messages, trimConfig);

        const callParams: CallParams = {
          system: systemPrompt,
          messages,
        };

        this.logger.info(JSON.stringify(callParams, null, 2));

        const result = await modelService.call(
          this.config.model ?? "",
          callParams,
          this.config.fallbackChain,
        );

        const rawText = result?.text ?? "";
        if (!rawText) {
          this.logger.info("Empty model response, breaking loop");
          break;
        }

        this.logger.info(`Model output: ${rawText}`);
        if (result?.reasoningText) {
          this.logger.info(`Model reasoning: ${result.reasoningText}`);
        }
        if (result?.usage) {
          this.logger.info(`=== Model Usage ===\n${JSON.stringify(result.usage, null, 2)}`);
        }

        // Parse JSON response
        let parsed = parser.parse(rawText);

        // LLM repair fallback if parse failed but "actions" present in raw text
        if (!parsed.data && rawText.includes("actions")) {
          this.logger.info("Parse failed, attempting LLM repair");
          parsed = await this.attemptLlmRepair(modelService, rawText);
        }

        if (!parsed.data || !Array.isArray(parsed.data.actions)) {
          // Fallback: model returned content without actions — wrap as send_message
          const raw = parsed.data as Record<string, unknown> | null;
          const fallbackContent = raw?.content;
          if (typeof fallbackContent === "string" && fallbackContent) {
            this.logger.info("No actions array, wrapping content as send_message");
            parsed = {
              data: { actions: [{ name: "send_message", params: { content: fallbackContent } }] },
              error: null,
              logs: [],
            };
          } else if (!parsed.data && rawText.trim().length > 0) {
            this.logger.info("Raw text output detected, wrapping as send_message");
            parsed = {
              data: { actions: [{ name: "send_message", params: { content: rawText.trim() } }] },
              error: null,
              logs: [],
            };
          } else {
            this.logger.info("Failed to parse agent response, breaking loop");
            break;
          }
        }

        const response = parsed.data!;

        if (response.thoughts) {
          this.logger.info(
            `[Thoughts] observe: ${response.thoughts.observe} | analyze: ${response.thoughts.analyze_infer} | plan: ${response.thoughts.plan}`,
          );
        }

        // Execute actions
        const { toolResults, hasToolCalls, hasActionCalls } = await this.executeActions(
          response.actions,
          pluginService,
          toolCtxWithPercept,
          maxResultLen,
        );

        // Record per-round AgentResponse immediately after tool execution
        await horizon.events.recordAgentResponse({
          scope: percept.scope,
          timestamp: new Date(),
          data: {
            round,
            assistantText: rawText,
            actions: response.actions,
            toolResults,
          },
        });

        // Determine continuation: Tool calls always continue (results must flow back),
        // request_heartbeat only controls continuation for pure Action calls
        const shouldContinue = hasToolCalls || (response.request_heartbeat ?? !hasActionCalls);

        if (!shouldContinue) break;

        // Force wrap-up on max rounds
        if (round >= maxRounds) {
          messages.push({ role: "assistant", content: rawText });
          messages.push({ role: "user", content: formatFinalRoundPrompt(toolResults) });

          trimMessages(messages, trimConfig);

          const wrapResult = await modelService.call(
            this.config.model ?? "",
            { system: systemPrompt, messages } as CallParams,
            this.config.fallbackChain,
          );
          if (wrapResult?.text) {
            const wrapParsed = parser.parse(wrapResult.text);
            if (wrapParsed.data?.actions) {
              const { toolResults: wrapToolResults } = await this.executeActions(
                wrapParsed.data.actions,
                pluginService,
                toolCtxWithPercept,
                maxResultLen,
              );
              await horizon.events.recordAgentResponse({
                scope: percept.scope,
                timestamp: new Date(),
                data: {
                  round: round + 1,
                  assistantText: wrapResult.text,
                  actions: wrapParsed.data.actions,
                  toolResults: wrapToolResults,
                },
              });
            }
          }
          break;
        }

        // Append messages for next round
        messages.push({ role: "assistant", content: rawText });
        messages.push({ role: "user", content: formatToolResults(toolResults) });
      }

      await horizon.events.markAsActive(percept.scope, new Date());
      const archiveMs =
        (this.ctx["yesimbot.horizon"] as HorizonService).config.archiveThresholdMs ?? 86400000;
      await horizon.events.archiveStale(percept.scope, archiveMs);

      this.logger.info(`Loop complete: ${round} rounds`);
    } finally {
      for (const d of disposers) d();
    }
  }

  private async executeActions(
    actions: AgentResponse["actions"],
    pluginService: PluginService,
    toolCtx: ToolExecutionContext,
    maxResultLen: number,
  ): Promise<{ toolResults: ToolResultEntry[]; hasToolCalls: boolean; hasActionCalls: boolean }> {
    const toolResults: ToolResultEntry[] = [];
    let hasToolCalls = false;
    let hasActionCalls = false;

    // Partition by type
    const toolActions: Array<{ idx: number; action: AgentResponse["actions"][0] }> = [];
    const actionActions: Array<{ idx: number; action: AgentResponse["actions"][0] }> = [];

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      const def = pluginService.getDefinition(action.name);
      if (def?.type === FunctionType.Action) {
        hasActionCalls = true;
        actionActions.push({ idx: i, action });
      } else {
        hasToolCalls = true;
        toolActions.push({ idx: i, action });
      }
    }

    // Execute Tool-type in parallel
    if (toolActions.length) {
      const results = await Promise.allSettled(
        toolActions.map(({ action }) =>
          pluginService.invoke(action.name, action.params ?? {}, toolCtx),
        ),
      );
      for (let i = 0; i < toolActions.length; i++) {
        const { idx, action } = toolActions[i];
        const r = results[i];
        toolResults.push(toToolResultEntry(idx, action.name, r, maxResultLen));
      }
    }

    // Execute Action-type sequentially
    for (const { idx, action } of actionActions) {
      try {
        const result = await pluginService.invoke(action.name, action.params ?? {}, toolCtx);
        toolResults.push(
          toToolResultEntry(idx, action.name, { status: "fulfilled", value: result }, maxResultLen),
        );
      } catch (e) {
        toolResults.push({
          id: idx,
          name: action.name,
          status: "failed",
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // Sort by original index
    toolResults.sort((a, b) => a.id - b.id);
    return { toolResults, hasToolCalls, hasActionCalls };
  }

  private async attemptLlmRepair(
    modelService: ModelService,
    rawText: string,
  ): Promise<ParseResult<AgentResponse>> {
    try {
      const repairResult = await modelService.call(this.config.model ?? "", {
        system:
          "Fix the following malformed JSON. Return ONLY valid JSON, no explanation. " +
          'The JSON must have an "actions" array with objects containing "name" and optional "params".',
        messages: [{ role: "user" as const, content: rawText }],
        maxOutputTokens: 4096,
      } as CallParams);
      if (repairResult?.text) {
        const parser = new JsonParser<AgentResponse>(this.logger);
        return parser.parse(repairResult.text);
      }
    } catch (e) {
      this.logger.info(`LLM repair failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    return { data: null, error: "LLM repair failed", logs: [] };
  }
}

function toToolResultEntry(
  idx: number,
  name: string,
  result: PromiseSettledResult<ToolResult>,
  maxLen: number,
): ToolResultEntry {
  if (result.status === "fulfilled") {
    const v = result.value;
    let resultVal = v.content;
    if (resultVal !== undefined) {
      const str = typeof resultVal === "string" ? resultVal : JSON.stringify(resultVal);
      if (str.length > maxLen) resultVal = str.slice(0, maxLen) + "...(truncated)";
    }
    return {
      id: idx,
      name,
      status: v.status,
      ...(resultVal !== undefined && { result: resultVal }),
      ...(v.error && { error: v.error }),
    };
  }
  return { id: idx, name, status: "failed", error: String(result.reason) };
}

function formatToolResults(results: ToolResultEntry[]): string {
  const compact = results.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    ...(r.result !== undefined && { result: r.result }),
    ...(r.error && { error: r.error }),
  }));
  return `Tool results:\n${JSON.stringify(compact)}\n\nRespond with a JSON object containing "actions" array.`;
}

function formatFinalRoundPrompt(results: ToolResultEntry[]): string {
  const base = formatToolResults(results);
  return (
    base +
    "\n\nYou have reached the maximum number of tool call rounds. " +
    "Based on the information gathered so far, please provide your final response now. " +
    "You must call send_message with your response."
  );
}
