import { writeFileSync } from "node:fs";
import path from "node:path";

import type { SystemModelMessage } from "ai";
import type { ModelMessage } from "ai";
import { Context, Random } from "koishi";

import type { HookService } from "../hook/service";
import { HookType } from "../hook/types";
import type { HorizonService } from "../horizon/service";
import { TimelineStage } from "../horizon/types";
import type { CallParams, ModelService } from "../model/service";
import type { PluginService } from "../plugin/service";
import { FunctionType, ToolExecutionContext, ToolResult } from "../plugin/types";
import type { PromptService } from "../prompt/service";
import type { Section } from "../prompt/types";
import type { Percept } from "../shared/types";
import type { SkillRegistry } from "../skill/service";
import type { SkillEffect } from "../skill/types";
import type { TraitAnalyzer } from "../trait/service";
import { JsonParser, type ParseResult } from "./json-parser";
import type { AgentCoreConfig } from "./service";
import { buildToolSchemaForPrompt } from "./tools";
import { trimMessages, totalChars, type LoopMessage, type TrimConfig } from "./trimmer";

interface AgentAction {
  name: string;
  params?: Record<string, unknown>;
}

interface AgentResponse {
  thoughts?: string;
  actions: Array<AgentAction>;
  request_heartbeat?: boolean;
}

interface ToolResultEntry {
  id: number;
  name: string;
  success: boolean;
  status?: string;
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
    this.logger.level = this.config.debugLevel ?? 2;
  }

  async run(
    percept: Percept,
    toolCtx: ToolExecutionContext,
  ): Promise<{ totalTokens: number; totalToolCalls: number }> {
    this.logger.info(`[${percept.traceId}] Starting loop type=${percept.type}`);
    let totalTokens = 0;
    let totalToolCalls = 0;

    const horizonService = this.ctx["yesimbot.horizon"] as HorizonService;
    const pluginService = this.ctx["yesimbot.plugin"] as PluginService;
    const promptService = this.ctx["yesimbot.prompt"] as PromptService;
    const modelService = this.ctx["yesimbot.model"] as ModelService;

    let view = await horizonService.buildView(
      { platform: percept.platform, channelId: percept.channelId },
      {
        session: toolCtx.session,
        selfId: toolCtx.bot?.selfId,
        selfName: toolCtx.bot?.user?.name,
      },
    );

    // Trait-Skill pipeline: analyze context, resolve active skills
    const trait = this.ctx["yesimbot.trait"] as TraitAnalyzer;
    const skill = this.ctx["yesimbot.skill"] as SkillRegistry;
    const signals = await trait.analyze(
      { platform: percept.platform, channelId: percept.channelId },
      view,
    );
    const effects: SkillEffect = skill.resolve(signals, {
      platform: percept.platform,
      channelId: percept.channelId,
    });

    const toolCtxWithPercept = {
      ...toolCtx,
      percept,
      botRole: view.self?.role,
      entities: view.entities,
      view,
      traits: signals,
      skills: effects.activeSkills,
    };

    // Agent before hook - allows hooks to inject context or modify behavior
    const hookService = this.ctx["yesimbot.hook"];
    if (hookService) {
      const beforeResult = await hookService.executeBefore(
        HookType.Agent,
        { view, traits: signals, skills: effects.activeSkills, percept },
        percept.traceId,
      );
      if (!beforeResult.skipped && beforeResult.params) {
        const modifiedParams = beforeResult.params as {
          view?: typeof view;
          traits?: typeof signals;
          skills?: typeof effects.activeSkills;
        };
        if (modifiedParams.view) view = modifiedParams.view;
        if (modifiedParams.traits) Object.assign(signals, modifiedParams.traits);
        if (modifiedParams.skills) Object.assign(effects.activeSkills, modifiedParams.skills);
      }
    }

    const disposers: Array<() => void> = [];

    // Apply prompt injections from active skills
    for (const inj of effects.promptInjections) {
      disposers.push(
        promptService.inject(this.ctx, inj.point, {
          name: `__skill_${inj.skillName}_${percept.id}`,
          renderFn: () => inj.content,
        }),
      );
    }

    // Apply style override from highest-specificity skill
    if (effects.styleOverride) {
      disposers.push(
        promptService.inject(this.ctx, effects.styleOverride.point, {
          name: `__skill_style_${percept.id}`,
          ...(effects.styleOverride.point === "soul" ? { after: "__role_soul" } : {}),
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
      promptService.inject(this.ctx, "instructions", {
        name: `__loop_tool_schema_${percept.id}`,
        after: "__role_tools",
        renderFn: () => toolSchema,
      }),
    );

    try {
      const sections: Section[] = await promptService.render("system", { view, percept });
      const stableContent = sections
        .filter((s) => s.name === "soul" || s.name === "instructions")
        .map((s) => s.content)
        .join("\n\n");
      const dynamicContent = sections
        .filter((s) => s.name === "extra")
        .map((s) => s.content)
        .join("\n\n");
      const systemPromptString = stableContent + "\n\n" + dynamicContent;

      const providerType = modelService.getProvider(
        (this.config.model ?? "").split(":")[0],
      )?.providerType;

      let systemParam: string | SystemModelMessage[];
      if (providerType === "anthropic") {
        systemParam = [
          {
            role: "system" as const,
            content: stableContent,
            providerOptions: {
              anthropic: { cacheControl: { type: "ephemeral" } },
            },
          },
          {
            role: "system" as const,
            content: dynamicContent,
          },
        ];
      } else {
        systemParam = systemPromptString;
      }

      const channelKey = `${percept.platform}:${percept.channelId}`;
      const arousalService = this.ctx["yesimbot.arousal"] as
        | { recordProactiveMessage?: (channelKey: string) => void }
        | undefined;
      const heartbeatRun = percept.metadata?.isHeartbeat === true;
      let proactiveQuotaRecorded = false;

      const recordSuccessfulSendMessages = async (
        actions: AgentResponse["actions"],
        toolResults: ToolResultEntry[],
      ) => {
        for (let actionId = 0; actionId < actions.length; actionId++) {
          const action = actions[actionId]!;
          if (action.name !== "send_message") continue;

          const sendResult = toolResults.find((t) => t.id === actionId && t.name === "send_message");
          if (!isSuccessfulSendResult(sendResult)) continue;

          if (heartbeatRun) {
            if (proactiveQuotaRecorded) {
              this.logger.debug(
                `[${percept.traceId}] proactive_quota_already_recorded action_id=${actionId}`,
              );
            } else if (typeof arousalService?.recordProactiveMessage === "function") {
              const chargeChannelKey = resolveProactiveChargeChannelKey(action, channelKey);
              arousalService.recordProactiveMessage(chargeChannelKey);
              proactiveQuotaRecorded = true;
            }
          }

          const content = String(action.params?.content ?? "");
          if (!content) continue;
          const parts = content.split(/<sep\s*\/?>/i).filter(Boolean);
          for (const part of parts) {
            await horizonService.events.recordMessage({
              platform: percept.platform,
              channelId: percept.channelId,
              stage: TimelineStage.Active,
              timestamp: new Date(),
              data: {
                messageId: Random.id(),
                senderId: toolCtx.bot?.selfId ?? "",
                senderName: toolCtx.bot?.user?.name ?? "",
                content: part.trim(),
              },
            });
          }
        }
      };

      const trimConfig: TrimConfig = {
        charBudget: this.config.charBudget ?? 30000,
        keepLastRounds: this.config.keepLastRounds ?? 2,
        softTrimHead: this.config.softTrimHead ?? 800,
        softTrimTail: this.config.softTrimTail ?? 800,
        initialContextCharBudget: this.config.initialContextCharBudget ?? 20000,
      };

      const imageConfig = {
        imageMode: (this.config.imageMode ?? "native") as "native" | "off",
        maxImagesInContext: this.config.maxImagesInContext ?? 3,
        imageLifecycleCount: this.config.imageLifecycleCount ?? 3,
      };
      const multiTurnMessages = await horizonService.formatHorizonText(view, percept, imageConfig);

      if ((this.config.debugLevel ?? 0) >= 3) {
        this.logger.debug(
          `[${percept.traceId}] system_stable_bytes=${Buffer.byteLength(stableContent, "utf8")} system_dynamic_bytes=${Buffer.byteLength(dynamicContent, "utf8")} provider=${providerType ?? "unknown"}`,
        );
      }

      const totalUserBytes = multiTurnMessages.reduce((sum, m) => {
        if (typeof m.content === "string") return sum + Buffer.byteLength(m.content, "utf8");
        return (
          sum +
          m.content.reduce(
            (s, p) => s + (p.type === "text" ? Buffer.byteLength(p.text, "utf8") : 0),
            0,
          )
        );
      }, 0);
      this.logger.debug(
        `[loop] [${percept.traceId}] system_bytes=${Buffer.byteLength(systemPromptString, "utf8")} user_bytes=${totalUserBytes} messages=${multiTurnMessages.length}`,
      );

      this.logger.info(`[${percept.traceId}] tools=${toolSchema ? "injected" : "none"}`);

      const messages: LoopMessage[] = multiTurnMessages;

      const maxRounds = this.config.maxRounds ?? 3;
      const maxResultLen = this.config.maxToolResultLength ?? 4000;
      let round = 0;

      const parser = new JsonParser<AgentResponse>(this.logger);

      while (round < maxRounds) {
        round++;
        this.logger.info(`[${percept.traceId}] Round ${round}/${maxRounds}`);

        trimMessages(messages, trimConfig);

        const callParams: CallParams = {
          system: systemParam,
          messages: messages as ModelMessage[],
          maxRetries: 0,
        };

        try {
          writeFileSync(
            path.join(this.ctx.baseDir, "data", "yesimbot", "last_call_params.json"),
            JSON.stringify(callParams, null, 2),
            "utf-8",
          );
        } catch (e) {}

        // this.logger.debug(`[loop] [${percept.traceId}] callParams=${JSON.stringify(callParams)}`);

        const callStart = Date.now();
        const result = await modelService.call(
          this.config.model ?? "",
          callParams,
          this.config.fallbackChain,
        );
        const callLatency = Date.now() - callStart;

        const rawText = result?.text ?? "";
        if (!rawText) {
          this.logger.info(`[${percept.traceId}] Empty model response, breaking loop`);
          break;
        }

        this.logger.debug(
          `[model] [${percept.traceId}] round=${round} latency=${callLatency}ms tokens_in=${result?.usage?.inputTokens ?? 0} tokens_out=${result?.usage?.outputTokens ?? 0}`,
        );

        totalTokens += (result?.usage?.inputTokens ?? 0) + (result?.usage?.outputTokens ?? 0);

        this.logger.debug(`[model] [${percept.traceId}] output=${rawText}`);
        if (result?.reasoningText) {
          this.logger.debug(`[model] [${percept.traceId}] reasoning=${result.reasoningText}`);
        }

        // Parse JSON response
        let parsed = parser.parse(rawText);

        this.logger.debug(
          `[parser] [${percept.traceId}] round=${round} success=${parsed.data !== null} error=${parsed.error ?? "none"}`,
        );

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
              data: {
                actions: [
                  {
                    name: "send_message",
                    params: { content: fallbackContent },
                  },
                ],
              },
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
          this.logger.info(`[Thoughts] ${response.thoughts}`);
        }

        // Execute actions
        const { toolResults, hasToolCalls, hasActionCalls } = await this.executeActions(
          response.actions,
          pluginService,
          toolCtxWithPercept,
          maxResultLen,
          percept,
        );

        totalToolCalls += toolResults.length;

        for (const r of toolResults) {
          this.logger.debug(
            `[tool] [${percept.traceId}] tool=${r.name} status=${r.status}${r.error ? ` error=${r.error}` : ""}`,
          );
        }

        // Record per-round AgentResponse immediately after tool execution
        await horizonService.events.recordAgentResponse({
          platform: percept.platform,
          channelId: percept.channelId,
          timestamp: new Date(),
          data: {
            rawText,
          },
        });

        // Record action execution results
        await horizonService.events.recordAgentAction({
          platform: percept.platform,
          channelId: percept.channelId,
          timestamp: new Date(),
          data: {
            actions: response.actions,
            toolResults,
          },
        });

        // Record bot sent messages as MessageRecord
        await recordSuccessfulSendMessages(response.actions, toolResults);

        // continue if there were any tool calls, or if request_heartbeat is true (for pure Action calls), or if any tools failed (to allow error info to flow back to model)
        const hasFailedTools = toolResults.some((r) => r.status === "failed" || r.error);

        // Determine continuation: Tool calls always continue (results must flow back),
        // request_heartbeat only controls continuation for pure Action calls
        const shouldContinue = hasToolCalls || response.request_heartbeat || hasFailedTools;

        if (!shouldContinue) break;

        // Force wrap-up on max rounds
        if (round >= maxRounds) {
          messages.push({ role: "assistant", content: rawText });
          messages.push({
            role: "user",
            content: formatFinalRoundPrompt(toolResults),
          });

          trimMessages(messages, trimConfig);

          const wrapResult = await modelService.call(
            this.config.model ?? "",
            { system: systemParam, messages } as CallParams,
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
                percept,
              );
              await horizonService.events.recordAgentResponse({
                platform: percept.platform,
                channelId: percept.channelId,
                timestamp: new Date(),
                data: {
                  rawText: wrapResult.text,
                },
              });

              // Record wrap-up action execution results
              await horizonService.events.recordAgentAction({
                platform: percept.platform,
                channelId: percept.channelId,
                timestamp: new Date(),
                data: {
                  actions: wrapParsed.data.actions,
                  toolResults: wrapToolResults,
                },
              });

              // Record bot sent messages from wrap-up round
              await recordSuccessfulSendMessages(wrapParsed.data.actions, wrapToolResults);
            }
          }
          break;
        }

        // Append messages for next round
        messages.push({ role: "assistant", content: rawText });
        messages.push({
          role: "user",
          content: formatToolResults(toolResults),
        });
      }

      await horizonService.events.markAsActive(
        { platform: percept.platform, channelId: percept.channelId },
        percept.timestamp,
      );

      // Trigger compression check (non-blocking, failure-isolated)
      const compressor = horizonService.compressor;
      if (compressor) {
        compressor
          .maybeCompress({ platform: percept.platform, channelId: percept.channelId })
          .catch((err) => {
            this.logger.warn(`[${percept.traceId}] Compression check failed (degraded):`, err);
          });
      }

      const archiveMs = horizonService.config.archiveThresholdMs ?? 86400000;
      await horizonService.events.archiveStale(
        { platform: percept.platform, channelId: percept.channelId },
        archiveMs,
      );

      this.logger.info(`[${percept.traceId}] Loop complete: ${round} rounds`);
      return { totalTokens, totalToolCalls };
    } finally {
      for (const d of disposers) d();
    }
  }

  private async executeActions(
    actions: AgentResponse["actions"],
    pluginService: PluginService,
    toolCtx: ToolExecutionContext,
    maxResultLen: number,
    percept: Percept,
  ): Promise<{
    toolResults: ToolResultEntry[];
    hasToolCalls: boolean;
    hasActionCalls: boolean;
  }> {
    const toolResults: ToolResultEntry[] = [];
    let hasToolCalls = false;
    let hasActionCalls = false;

    const hookService = this.ctx["yesimbot.hook"];

    // Partition by type
    const toolActions: Array<{ idx: number; action: AgentAction }> = [];
    const actionActions: Array<{ idx: number; action: AgentAction }> = [];

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
        toolActions.map(async ({ action }) => {
          let params = action.params ?? {};

          // Before hook
          if (hookService) {
            const beforeResult = await hookService.executeBefore(
              HookType.Tool,
              params,
              percept.traceId,
            );
            if (beforeResult.skipped) {
              return beforeResult.result as ToolResult;
            }
            params = beforeResult.params;
          }

          const result = await pluginService.invoke(action.name, params, toolCtx);

          // After hook
          if (hookService) {
            await hookService.executeAfter(HookType.Tool, params, result, percept.traceId);
          }

          return result;
        }),
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
          success: false,
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
      success: v.success,
      ...(resultVal !== undefined && { result: resultVal }),
      ...(v.error && { error: v.error }),
    };
  }
  return { id: idx, name, success: false, status: "failed", error: String(result.reason) };
}

function formatToolResults(results: ToolResultEntry[]): string {
  const items = results.map((r) => {
    const status = r.error ? "error" : r.status;
    const content =
      r.name === "send_message" ? "sent" : r.result != null ? String(r.result) : (r.error ?? "");
    return `  <tool-result name="${r.name}" status="${status}">${content}</tool-result>`;
  });
  return `<tool-results>\n${items.join("\n")}\n</tool-results>\n\nRespond with a JSON object containing "actions" array.`;
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

function isSuccessfulSendResult(result: ToolResultEntry | undefined): boolean {
  if (!result) return false;
  if (result.error) return false;
  return result.status === "ok" || result.status === "fulfilled";
}

function resolveProactiveChargeChannelKey(action: AgentAction, fallbackChannelKey: string): string {
  const target = action.params?.target;
  if (!target || typeof target !== "object") return fallbackChannelKey;

  const sendTarget = target as { platform?: unknown; channelId?: unknown };
  if (typeof sendTarget.platform !== "string" || typeof sendTarget.channelId !== "string") {
    return fallbackChannelKey;
  }

  return `${sendTarget.platform}:${sendTarget.channelId}`;
}
