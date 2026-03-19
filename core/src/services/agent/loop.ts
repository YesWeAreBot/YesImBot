import { writeFileSync } from "node:fs";
import path from "node:path";

import type { ModelMessage, SystemModelMessage } from "ai";
import { Context } from "koishi";

import {
  bindCommittedRoundContext,
  buildScenarioFromView,
  commitRoundContext,
} from "../../runtime/adapters";
import type {
  AgentEndSummary,
  AgentFinalOutcomeStatus,
  AgentIncident,
  Percept,
  RoundContext,
  Scenario,
} from "../../runtime/contracts";
import { buildAgentRoundContext } from "../../shared/context-factory";
import type { ActiveSkill } from "../../shared/types";
import type { HookService } from "../hook/service";
import { HookType } from "../hook/types";
import type { HorizonService } from "../horizon/service";
import type { HorizonView } from "../horizon/types";
import type { CallParams, ModelService } from "../model/service";
import type { PluginService } from "../plugin/service";
import {
  FunctionType,
  RoundActionResultEntry,
  RuntimeToolExecutionContext,
  ToolExecutionContext,
} from "../plugin/types";
import type { PromptService } from "../prompt/service";
import type { PromptFragment } from "../prompt/types";
import type { SkillRegistry } from "../skill/service";
import { AgentSessionStore, projectSkillState } from "../skill/session-store";
import type { SkillDefinition } from "../skill/types";
import { JsonParser, type ParseResult } from "./json-parser";
import type { AgentCoreConfig } from "./service";
import { buildToolPromptFragments } from "./tools";
import { trimMessages, type LoopMessage, type TrimConfig } from "./trimmer";

interface AgentAction {
  name: string;
  params?: Record<string, unknown>;
}

interface AgentResponse {
  thoughts?: string;
  actions: Array<AgentAction>;
  request_heartbeat?: boolean;
}

type ToolResultEntry = RoundActionResultEntry;

interface AgentStartMutableParams {
  view: HorizonView | undefined;
  skills: NonNullable<RuntimeToolExecutionContext["skills"]>;
  percept: Percept;
  roundContext: RoundContext;
  scenario: RoundContext["scenario"];
  capabilities: RoundContext["capabilities"];
  metadata: RoundContext["metadata"];
  skillState: RoundContext["skillState"];
}

interface AgentEndParams {
  roundContext: RoundContext;
  scenario: RoundContext["scenario"];
  capabilities: RoundContext["capabilities"];
  lifecycle: "end";
  endSummary: AgentEndSummary;
}

interface SettlementCounters {
  total: number;
  succeeded: number;
  failed: number;
  names: Set<string>;
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
    const resolvers =
      typeof pluginService.getCapabilityResolvers === "function"
        ? pluginService.getCapabilityResolvers(percept.platform)
        : [];

    const built = await buildAgentRoundContext(this.ctx, {
      platform: percept.platform,
      channelId: percept.channelId,
      session: toolCtx.session,
      bot: toolCtx.bot,
      percept,
      toolCtx,
      resolvers,
    });
    let runtimeToolCtx: RuntimeToolExecutionContext = built.toolCtx;
    let roundContext: RoundContext = built.roundContext;
    const incidents: AgentIncident[] = [];
    const actionCounters = createSettlementCounters();
    const toolCounters = createSettlementCounters();
    let producedVisibleOutput = false;
    let finalStatus: AgentFinalOutcomeStatus = "silent";

    let view = runtimeToolCtx.view;
    if (!view) {
      try {
        view = await horizonService.buildView(
          { platform: percept.platform, channelId: percept.channelId },
          {
            session: runtimeToolCtx.session,
            selfId: runtimeToolCtx.bot?.selfId,
            selfName: runtimeToolCtx.bot?.user?.name,
          },
        );
      } catch (err) {
        view = {
          self: {
            id: runtimeToolCtx.bot?.selfId ?? "unknown-bot",
            name: runtimeToolCtx.bot?.user?.name ?? "assistant",
          },
          environment: {
            type: "unknown",
            id: percept.channelId,
            name: percept.channelId,
            platform: percept.platform,
            channelId: percept.channelId,
          },
          entities: [],
          history: [],
        };
        this.logger.warn(
          `[${percept.traceId}] failed to build horizon view (degraded): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const skillCatalog = this.ctx["yesimbot.skill"] as SkillRegistry | undefined;
    const sessionStore = this.ctx["yesimbot.session"] as AgentSessionStore | undefined;

    const hookService = this.ctx["yesimbot.hook"] as HookService | undefined;
    if (hookService) {
      const startParams: AgentStartMutableParams = {
        view,
        skills: runtimeToolCtx.skills ?? [],
        percept,
        roundContext,
        scenario: roundContext.snapshot.scenario,
        capabilities: roundContext.snapshot.capabilities,
        metadata: roundContext.snapshot.metadata,
        skillState: roundContext.skillState,
      };
      const beforeResult =
        typeof hookService.executeAgentStart === "function"
          ? await hookService.executeAgentStart(startParams, percept.traceId)
          : await hookService.executeBefore(HookType.Agent, startParams, percept.traceId);
      if (beforeResult.skipped) {
        finalStatus = "skipped";
        incidents.push({
          phase: "start",
          category: "hook-skip",
          summary: "agent start requested skip",
          recovered: true,
          detail:
            beforeResult.result === undefined
              ? undefined
              : stringifyIncidentDetail(beforeResult.result),
        });
        const endSummary: AgentEndSummary = {
          finalOutcome: {
            status: "skipped",
            producedVisibleOutput: false,
            actions: settlementCountersToSummary(actionCounters),
            toolCalls: settlementCountersToSummary(toolCounters),
          },
          incidents,
        };
        const endParams: AgentEndParams = {
          roundContext,
          scenario: roundContext.snapshot.scenario,
          capabilities: roundContext.snapshot.capabilities,
          lifecycle: "end",
          endSummary,
        };
        if (typeof hookService.executeAgentEnd === "function") {
          await hookService.executeAgentEnd(endParams, percept.traceId);
        } else {
          await hookService.executeAfter(HookType.Agent, endParams, endSummary, percept.traceId);
        }
        return { totalTokens, totalToolCalls };
      }
      if (!beforeResult.skipped && beforeResult.params && typeof beforeResult.params === "object") {
        const modifiedParams = beforeResult.params;
        const modifiedParamRecord = modifiedParams as unknown as Record<string, unknown>;

        if ("loadSkill" in modifiedParamRecord || "getLoadedSkills" in modifiedParamRecord) {
          this.logger.warn(
            `[${percept.traceId}] agent start hook attempted removed skill load helpers; ignored`,
          );
        }

        const updatedView = modifiedParams.view;
        const updatedSkills = modifiedParams.skills;

        if (updatedView) view = updatedView;
        if (updatedSkills && !isSameActiveSkillList(updatedSkills, runtimeToolCtx.skills ?? [])) {
          this.logger.warn(
            `[${percept.traceId}] agent start hook attempted legacy skills mutation; ignored`,
          );
        }

        const updatedScenario = modifiedParams.scenario as Scenario | undefined;
        const updatedCapabilities = modifiedParams.capabilities as RoundContext["capabilities"];
        const updatedMetadata = modifiedParams.metadata as Record<string, unknown>;
        const updatedSkillState = modifiedParams.skillState as RoundContext["skillState"];
        const shouldRebuildScenarioFromView = updatedView && !updatedScenario;
        const nextScenario = shouldRebuildScenarioFromView
          ? buildScenarioFromView({
              view,
              stimulusSource: roundContext.snapshot.scenario.raw.stimulusSource,
            })
          : updatedScenario;

        if (nextScenario || updatedCapabilities || updatedMetadata || updatedSkillState) {
          roundContext = commitRoundContext(roundContext, {
            scenario: nextScenario,
            capabilities: updatedCapabilities,
            metadata: updatedMetadata,
            skillState: updatedSkillState,
          });
        }
      }
    }

    let currentAllowedTools: string[] = [];
    let currentLoadedSkills: SkillDefinition[] = [];

    const refreshRuntimeSkillState = () => {
      const sessionState = sessionStore?.getState(percept.platform, percept.channelId);
      currentLoadedSkills = sessionState?.loadedSkills.length
        ? sessionState.loadedSkills.flatMap((skillName) => {
            const definition = skillCatalog?.get(skillName);
            return definition ? [definition] : [];
          })
        : [];
      currentAllowedTools = Array.from(
        new Set(currentLoadedSkills.flatMap((skill) => skill.allowedTools ?? [])),
      );

      roundContext = commitRoundContext(roundContext, {
        skillState: sessionState ? projectSkillState(sessionState) : { active: [] },
      });

      runtimeToolCtx = bindCommittedRoundContext(
        {
          ...runtimeToolCtx,
          percept,
          skills: toActiveSkills(currentLoadedSkills),
        },
        roundContext,
      ) as RuntimeToolExecutionContext;
    };

    refreshRuntimeSkillState();

    const disposers: Array<() => void> = [];

    registerPromptFragmentSource(
      promptService,
      disposers,
      `__loop_skill_catalog_${percept.id}`,
      () => buildSkillCatalogPromptFragments(skillCatalog?.all() ?? [], roundContext.skillState),
    );
    registerPromptFragmentSource(
      promptService,
      disposers,
      `__loop_tool_fragments_${percept.id}`,
      () => buildToolPromptFragments(pluginService, runtimeToolCtx, currentAllowedTools),
    );

    try {
      const providerType = modelService.getProvider(
        (this.config.model ?? "").split(":")[0],
      )?.providerType;

      const channelKey = `${percept.platform}:${percept.channelId}`;
      const arousalService = this.ctx["yesimbot.arousal"] as
        | { recordProactiveMessage?: (channelKey: string) => void }
        | undefined;
      const heartbeatRun = percept.metadata?.isHeartbeat === true;
      let proactiveQuotaRecorded = false;

      const recordSuccessfulSendMessages = (
        actions: AgentResponse["actions"],
        toolResults: ToolResultEntry[],
      ) => {
        for (let actionId = 0; actionId < actions.length; actionId++) {
          const action = actions[actionId]!;
          if (action.name !== "send_message") continue;

          const sendResult = toolResults.find(
            (t) => t.id === actionId && t.name === "send_message",
          );
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
      const scenarioTimeline = roundContext.snapshot.scenario.raw.scenarioTimeline;
      const multiTurnMessages = await horizonService.formatHorizonText(
        view,
        percept,
        imageConfig,
        scenarioTimeline,
      );

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
        `[loop] [${percept.traceId}] user_bytes=${totalUserBytes} messages=${multiTurnMessages.length}`,
      );

      this.logger.info(`[${percept.traceId}] tools=fragments`);

      const messages: LoopMessage[] = multiTurnMessages;

      const maxRounds = this.config.maxRounds ?? 3;
      const maxResultLen = this.config.maxToolResultLength ?? 4000;
      let round = 0;

      const parser = new JsonParser<AgentResponse>(this.logger);

      while (round < maxRounds) {
        refreshRuntimeSkillState();
        round++;
        this.logger.info(`[${percept.traceId}] Round ${round}/${maxRounds}`);

        const renderedPrompt = await renderSystemPrompt(
          promptService,
          providerType,
          percept,
          roundContext,
        );

        if ((this.config.debugLevel ?? 0) >= 3) {
          this.logger.debug(
            `[${percept.traceId}] system_stable_bytes=${Buffer.byteLength(renderedPrompt.stableContent, "utf8")} system_dynamic_bytes=${Buffer.byteLength(renderedPrompt.dynamicContent, "utf8")} provider=${providerType ?? "unknown"} stableSignature=${renderedPrompt.stableSignature}`,
          );
        }

        const sectionNames = renderedPrompt.sections.map((section) => section.name).join("|");
        this.logger.debug(
          `[${percept.traceId}] emitPromptBlocks sections=${sectionNames} stableSignature=${renderedPrompt.stableSignature}`,
        );

        this.logger.debug(
          `[loop] [${percept.traceId}] system_bytes=${Buffer.byteLength(renderedPrompt.systemPromptString, "utf8")}`,
        );

        trimMessages(messages, trimConfig);

        const callParams: CallParams = {
          system: renderedPrompt.systemParam,
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
        const result = await (this.config.streamMode
          ? modelService.streamCall(this.config.model ?? "", callParams, this.config.fallbackChain)
          : modelService.call(this.config.model ?? "", callParams, this.config.fallbackChain));
        const callLatency = Date.now() - callStart;

        const rawText =
          typeof result?.text === "string"
            ? result.text
            : isPromiseLike<string>(result?.text)
              ? await result.text
              : hasTextStream(result)
                ? await collectTextStream(result.textStream)
                : "";
        if (!rawText) {
          this.logger.info(`[${percept.traceId}] Empty model response, breaking loop`);
          break;
        }

        const usage = isPromiseLike<{ inputTokens?: number; outputTokens?: number }>(result?.usage)
          ? await result.usage
          : result?.usage;

        messages.push({ role: "assistant", content: rawText });

        this.logger.debug(
          `[model] [${percept.traceId}] round=${round} latency=${callLatency}ms tokens_in=${usage?.inputTokens ?? 0} tokens_out=${usage?.outputTokens ?? 0}`,
        );

        totalTokens += (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);

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

        await horizonService.events.recordAgentResponse({
          platform: percept.platform,
          channelId: percept.channelId,
          timestamp: new Date(),
          data: {
            rawText,
          },
        });

        // Execute actions
        const { toolResults, hasToolCalls } = await pluginService.executeRoundActions(
          response.actions,
          runtimeToolCtx,
          percept.traceId,
          maxResultLen,
        );

        totalToolCalls += toolResults.length;
        const roundSettlement = collectRoundSettlement(
          response.actions,
          toolResults,
          pluginService,
        );
        mergeSettlementCounters(actionCounters, roundSettlement.actions);
        mergeSettlementCounters(toolCounters, roundSettlement.toolCalls);
        producedVisibleOutput ||= roundSettlement.producedVisibleOutput;
        incidents.push(...roundSettlement.incidents);

        for (const r of toolResults) {
          this.logger.debug(
            `[tool] [${percept.traceId}] tool=${r.name} status=${r.status}${r.error ? ` error=${r.error}` : ""}`,
          );
        }

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
          messages.push({
            role: "user",
            content: formatFinalRoundPrompt(toolResults),
          });

          trimMessages(messages, trimConfig);

          refreshRuntimeSkillState();
          const wrapPrompt = await renderSystemPrompt(
            promptService,
            providerType,
            percept,
            roundContext,
          );

          const wrapResult = await modelService.call(
            this.config.model ?? "",
            { system: wrapPrompt.systemParam, messages } as CallParams,
            this.config.fallbackChain,
          );
          if (wrapResult?.text) {
            await horizonService.events.recordAgentResponse({
              platform: percept.platform,
              channelId: percept.channelId,
              timestamp: new Date(),
              data: {
                rawText: wrapResult.text,
              },
            });
            const wrapParsed = parser.parse(wrapResult.text);
            if (wrapParsed.data?.actions) {
              const { toolResults: wrapToolResults } = await pluginService.executeRoundActions(
                wrapParsed.data.actions,
                runtimeToolCtx,
                percept.traceId,
                maxResultLen,
              );
              const wrapSettlement = collectRoundSettlement(
                wrapParsed.data.actions,
                wrapToolResults,
                pluginService,
              );
              mergeSettlementCounters(actionCounters, wrapSettlement.actions);
              mergeSettlementCounters(toolCounters, wrapSettlement.toolCalls);
              producedVisibleOutput ||= wrapSettlement.producedVisibleOutput;
              incidents.push(...wrapSettlement.incidents);
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

      finalStatus = deriveFinalStatus({
        current: finalStatus,
        producedVisibleOutput,
        incidents,
      });
      this.logger.info(`[${percept.traceId}] Loop complete: ${round} rounds`);
      return { totalTokens, totalToolCalls };
    } catch (err) {
      finalStatus = "failed";
      incidents.push({
        phase: "think-act",
        category: "runtime-error",
        summary: err instanceof Error ? err.message : String(err),
        recovered: false,
      });
      throw err;
    } finally {
      for (const d of disposers) d();
      const hookService = this.ctx["yesimbot.hook"] as HookService | undefined;
      if (hookService) {
        const endSummary: AgentEndSummary = {
          finalOutcome: {
            status: deriveFinalStatus({
              current: finalStatus,
              producedVisibleOutput,
              incidents,
            }),
            producedVisibleOutput,
            actions: settlementCountersToSummary(actionCounters),
            toolCalls: settlementCountersToSummary(toolCounters),
          },
          incidents,
        };
        const endParams: AgentEndParams = {
          roundContext,
          scenario: roundContext.snapshot.scenario,
          capabilities: roundContext.snapshot.capabilities,
          lifecycle: "end",
          endSummary,
        };
        if (typeof hookService.executeAgentEnd === "function") {
          await hookService.executeAgentEnd(endParams, percept.traceId);
        } else {
          await hookService.executeAfter(HookType.Agent, endParams, endSummary, percept.traceId);
        }
      }
    }
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

function toActiveSkills(skills: SkillDefinition[]): ActiveSkill[] {
  return skills.map((skill) => ({
    name: skill.name,
    effects: skill.allowedTools?.length ? ["tools"] : ["guidance"],
    metadata: { description: skill.description, allowedTools: skill.allowedTools ?? [] },
  }));
}

async function renderSystemPrompt(
  promptService: PromptService,
  providerType: string | undefined,
  percept: Percept,
  roundContext: RoundContext,
): Promise<{
  sections: Array<{ name: string; content: string; cacheable?: boolean }>;
  stableContent: string;
  dynamicContent: string;
  stableSignature: string;
  systemPromptString: string;
  systemParam: string | SystemModelMessage[];
}> {
  const emitted = await promptService.emitPromptBlocks(
    "system",
    {
      percept,
      roundContext,
      scenario: roundContext.snapshot.scenario,
      capabilities: roundContext.snapshot.capabilities,
    },
    { providerType },
  );

  const stableContent = emitted.stableBlock;
  const dynamicContent = emitted.dynamicBlock;
  const systemPromptString = [stableContent, dynamicContent].filter(Boolean).join("\n\n");

  let systemParam: string | SystemModelMessage[];
  if (providerType === "anthropic") {
    const anthropicBlocks: SystemModelMessage[] = [];
    if (stableContent) {
      anthropicBlocks.push({
        role: "system",
        content: stableContent,
        providerOptions: {
          anthropic: { cacheControl: { type: "ephemeral" } },
        },
      });
    }
    if (dynamicContent) {
      anthropicBlocks.push({
        role: "system",
        content: dynamicContent,
      });
    }
    systemParam = anthropicBlocks.length > 0 ? anthropicBlocks : "";
  } else {
    systemParam = systemPromptString;
  }

  return {
    sections: emitted.sections,
    stableContent,
    dynamicContent,
    stableSignature: emitted.stableSignature,
    systemPromptString,
    systemParam,
  };
}

function buildSkillCatalogPromptFragments(
  skills: SkillDefinition[],
  skillState: RoundContext["skillState"],
): PromptFragment[] {
  if (skills.length === 0) {
    return [];
  }

  const loadedSkillNames = new Set(
    (skillState.loadHistory ?? []).flatMap((entry) => {
      const historyEntry = entry as { name?: string; skillName?: string };
      if (typeof historyEntry.name === "string") return [historyEntry.name];
      if (typeof historyEntry.skillName === "string") return [historyEntry.skillName];
      return [];
    }),
  );

  const content = ["<skills>", "Registered skills (use loadSkill to activate):"]
    .concat(
      skills.map((skill) => {
        const loadedMarker = loadedSkillNames.has(skill.name) ? " [loaded]" : "";
        return `- ${skill.name}: ${skill.description}${loadedMarker}`;
      }),
    )
    .concat(["</skills>"])
    .join("\n");

  return [
    {
      id: "skill.catalog",
      content,
      section: "situation",
      source: "skill",
      priority: 510,
      stability: "dynamic",
      cacheable: false,
    },
  ];
}

function isSameActiveSkillList(next: ActiveSkill[], previous: ActiveSkill[]): boolean {
  if (next.length !== previous.length) return false;
  for (let i = 0; i < next.length; i++) {
    if (next[i]?.name !== previous[i]?.name) return false;
  }
  return true;
}

function registerPromptFragmentSource(
  promptService: PromptService,
  disposers: Array<() => void>,
  name: string,
  provider: (scope: Record<string, unknown>) => PromptFragment[] | Promise<PromptFragment[]>,
): void {
  if (typeof promptService.registerFragmentSource === "function") {
    disposers.push(promptService.registerFragmentSource(name, provider));
  }
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

function createSettlementCounters(): SettlementCounters {
  return {
    total: 0,
    succeeded: 0,
    failed: 0,
    names: new Set<string>(),
  };
}

function mergeSettlementCounters(target: SettlementCounters, source: SettlementCounters): void {
  target.total += source.total;
  target.succeeded += source.succeeded;
  target.failed += source.failed;
  for (const name of source.names) {
    target.names.add(name);
  }
}

function settlementCountersToSummary(counters: SettlementCounters) {
  return {
    total: counters.total,
    succeeded: counters.succeeded,
    failed: counters.failed,
    names: Array.from(counters.names),
  };
}

function deriveFinalStatus(input: {
  current: AgentFinalOutcomeStatus;
  producedVisibleOutput: boolean;
  incidents: AgentIncident[];
}): AgentFinalOutcomeStatus {
  if (input.current === "failed" || input.current === "skipped") {
    return input.current;
  }
  if (input.incidents.some((incident) => !incident.recovered)) {
    return "failed";
  }
  if (input.incidents.length > 0) {
    return "degraded";
  }
  return input.producedVisibleOutput ? "success" : "silent";
}

function stringifyIncidentDetail(input: unknown): string {
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function hasTextStream(value: unknown): value is { textStream: AsyncIterable<string> } {
  return (
    typeof value === "object" &&
    value !== null &&
    "textStream" in value &&
    typeof (value as { textStream?: unknown }).textStream === "object"
  );
}

async function collectTextStream(stream: AsyncIterable<string>): Promise<string> {
  let output = "";
  for await (const chunk of stream) {
    output += chunk;
  }
  return output;
}

function collectRoundSettlement(
  actions: AgentResponse["actions"],
  toolResults: ToolResultEntry[],
  pluginService: PluginService,
): {
  actions: SettlementCounters;
  toolCalls: SettlementCounters;
  producedVisibleOutput: boolean;
  incidents: AgentIncident[];
} {
  const actionCounters = createSettlementCounters();
  const toolCounters = createSettlementCounters();
  const incidents: AgentIncident[] = [];

  for (const action of actions) {
    const def = pluginService.getDefinition(action.name);
    const target = def?.type === FunctionType.Action ? actionCounters : toolCounters;
    target.names.add(action.name);
  }

  let producedVisibleOutput = false;
  for (const result of toolResults) {
    const def = pluginService.getDefinition(result.name);
    const isAction = def?.type === FunctionType.Action;
    const target = isAction ? actionCounters : toolCounters;

    target.total += 1;
    target.names.add(result.name);

    const success = !result.error && result.status !== "failed";
    if (success) {
      target.succeeded += 1;
    } else {
      target.failed += 1;
    }

    if (isAction && result.name === "send_message" && success) {
      producedVisibleOutput = true;
    }

    if (!isAction && !success) {
      incidents.push({
        phase: "tool",
        category: "tool-error",
        summary: `${result.name} failed`,
        recovered: true,
        detail: result.error,
      });
    }
  }

  return {
    actions: actionCounters,
    toolCalls: toolCounters,
    producedVisibleOutput,
    incidents,
  };
}
