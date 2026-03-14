import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";

import type { SystemModelMessage } from "ai";
import type { ModelMessage } from "ai";
import { Context, Random } from "koishi";

import type { HookService } from "../hook/service";
import { HookType } from "../hook/types";
import type { HorizonService } from "../horizon/service";
import { TimelineStage, type HorizonView } from "../horizon/types";
import type { CallParams, ModelService } from "../model/service";
import type { PluginService } from "../plugin/service";
import { FunctionType, ToolExecutionContext, ToolResult } from "../plugin/types";
import type { PromptService } from "../prompt/service";
import type { PromptFragment, RenderedPromptSection } from "../prompt/types";
import {
  bindCommittedRoundContext,
  buildScenarioFromView,
  commitRoundContext,
} from "../runtime/adapters";
import type {
  AgentEndSummary,
  AgentFinalOutcomeStatus,
  AgentIncident,
  RoundContext,
  Scenario,
} from "../runtime/contracts";
import { buildAgentRoundContext, inheritPersistentRoster } from "../shared/context-factory";
import type { ActiveSkill, Percept } from "../shared/types";
import { SkillEffectApplier } from "../skill/applier";
import { LoadedSkillSet } from "../skill/loaded-skill-set";
import type { SkillRegistry } from "../skill/service";
import type { LoadResult, SkillDefinition } from "../skill/types";
import { JsonParser, type ParseResult } from "./json-parser";
import type { AgentCoreConfig } from "./service";
import { buildToolPromptFragments } from "./tools";
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

interface AgentStartMutableParams {
  view: HorizonView | undefined;
  /** @deprecated Prefer hook-driven loadSkill() and getLoadedSkills(). */
  traits: NonNullable<ToolExecutionContext["traits"]>;
  /** @deprecated Prefer hook-driven loadSkill() and getLoadedSkills(). */
  skills: NonNullable<ToolExecutionContext["skills"]>;
  loadSkill(skillName: string): Promise<LoadResult>;
  getLoadedSkills(): SkillDefinition[];
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
    let runtimeToolCtx: ToolExecutionContext = built.toolCtx;
    let roundContext: RoundContext = built.roundContext;
    const incidents: AgentIncident[] = [];
    const actionCounters = createSettlementCounters();
    const toolCounters = createSettlementCounters();
    let producedVisibleOutput = false;
    let finalStatus: AgentFinalOutcomeStatus = "silent";

    const runtimeToolCtxWithView = runtimeToolCtx as ToolExecutionContext & { view?: HorizonView };
    let view = runtimeToolCtxWithView.view;
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
    const hasSkillCatalogGet = Boolean(skillCatalog && typeof skillCatalog.get === "function");
    let loadedSkills =
      hasSkillCatalogGet && roundContext.skillState.persistentRoster
        ? inheritPersistentRoster(
            roundContext.skillState.persistentRoster,
            skillCatalog as SkillRegistry,
          )
        : new LoadedSkillSet();
    const applier = new SkillEffectApplier();
    let signals = runtimeToolCtx.traits ?? [];
    let legacySkillsForToolCtx: NonNullable<ToolExecutionContext["skills"]> | undefined;

    const loadSkill = async (skillName: string): Promise<LoadResult> => {
      if (!hasSkillCatalogGet) {
        const reason = "skill catalog unavailable";
        loadedSkills.recordLoadAttempt(skillName, "not_found", reason);
        return { status: "not_found", reason };
      }

      const definition = (skillCatalog as SkillRegistry).get(skillName);
      if (!definition) {
        const reason = `skill "${skillName}" not found in catalog`;
        loadedSkills.recordLoadAttempt(skillName, "not_found", reason);
        return { status: "not_found", reason };
      }

      return loadedSkills.load(definition);
    };

    const hookService = this.ctx["yesimbot.hook"] as HookService | undefined;
    if (hookService) {
      const legacySkillsBeforeHook = toActiveSkills(loadedSkills.getLoaded());
      const startParams: AgentStartMutableParams = {
        view,
        traits: signals,
        skills: legacySkillsBeforeHook,
        loadSkill,
        getLoadedSkills: () => loadedSkills.getLoaded(),
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

        const updatedView = modifiedParams.view;
        const updatedTraits = modifiedParams.traits;
        const updatedSkills = modifiedParams.skills;

        if (updatedView) view = updatedView;
        if (updatedTraits) signals = updatedTraits;
        if (updatedSkills && !isSameActiveSkillList(updatedSkills, legacySkillsBeforeHook)) {
          if (hasSkillCatalogGet) {
            loadedSkills = this.syncLoadedSkillsFromLegacyCompat(
              updatedSkills,
              loadedSkills,
              skillCatalog,
            );
          } else {
            legacySkillsForToolCtx = updatedSkills;
          }
        }

        const updatedScenario = modifiedParams.scenario as Scenario | undefined;
        const updatedCapabilities = modifiedParams.capabilities as RoundContext["capabilities"];
        const updatedMetadata = modifiedParams.metadata as Record<string, unknown>;
        const updatedSkillState = modifiedParams.skillState as RoundContext["skillState"];
        const derivedSkillState =
          updatedSkills && !updatedSkillState
            ? {
                active: loadedSkills.getLoadedNames(),
                loadHistory: loadedSkills.getLoadHistory(),
                persistentRoster: loadedSkills.getLoadedNames(),
              }
            : undefined;

        const shouldRebuildScenarioFromView = updatedView && !updatedScenario;
        const nextScenario = shouldRebuildScenarioFromView
          ? buildScenarioFromView({
              view,
              stimulusSource: roundContext.snapshot.scenario.raw.stimulusSource,
            })
          : updatedScenario;

        if (
          nextScenario ||
          updatedCapabilities ||
          updatedMetadata ||
          updatedSkillState ||
          derivedSkillState
        ) {
          roundContext = commitRoundContext(roundContext, {
            scenario: nextScenario,
            capabilities: updatedCapabilities,
            metadata: updatedMetadata,
            skillState: updatedSkillState ?? derivedSkillState,
          });
        }
      }
    }

    const appliedEffects = applier.apply(loadedSkills);
    roundContext = commitRoundContext(roundContext, {
      skillState: {
        active: legacySkillsForToolCtx
          ? legacySkillsForToolCtx.map((skill) => skill.name)
          : loadedSkills.getLoadedNames(),
        loadHistory: loadedSkills.getLoadHistory(),
        persistentRoster: legacySkillsForToolCtx
          ? legacySkillsForToolCtx.map((skill) => skill.name)
          : loadedSkills.getLoadedNames(),
      },
    });

    const toolCtxWithPercept = bindCommittedRoundContext(
      {
        ...runtimeToolCtx,
        percept,
        view,
        traits: signals,
        skills: legacySkillsForToolCtx ?? toActiveSkills(loadedSkills.getLoaded()),
      },
      roundContext,
    ) as ToolExecutionContext;

    const disposers: Array<() => void> = [];

    if (appliedEffects.promptFragments.length > 0 || appliedEffects.styleFragment) {
      const allFragments = [
        ...appliedEffects.promptFragments,
        ...(appliedEffects.styleFragment ? [appliedEffects.styleFragment] : []),
      ];
      registerPromptFragmentSource(
        promptService,
        disposers,
        `__skill_effects_${percept.id}`,
        () => allFragments,
      );
    }

    const toolPromptFragments = buildToolPromptFragments(
      pluginService,
      toolCtxWithPercept,
      appliedEffects.toolVisibility,
    );
    registerPromptFragmentSource(
      promptService,
      disposers,
      `__loop_tool_fragments_${percept.id}`,
      () => toolPromptFragments,
    );

    try {
      const providerType = modelService.getProvider(
        (this.config.model ?? "").split(":")[0],
      )?.providerType;
      const promptScope = {
        view,
        percept,
        roundContext,
        scenario: roundContext.snapshot.scenario,
        capabilities: roundContext.snapshot.capabilities,
      };
      const emitted =
        typeof promptService.emitPromptBlocks === "function"
          ? await promptService.emitPromptBlocks("system", promptScope, { providerType })
          : await emitPromptBlocksCompat(promptService, promptScope);
      const sections: RenderedPromptSection[] = emitted.sections;
      const stableContent = emitted.stableBlock;
      const dynamicContent = emitted.dynamicBlock;
      const stableSignature = emitted.stableSignature;
      const systemPromptString = [stableContent, dynamicContent].filter(Boolean).join("\n\n");

      let systemParam: string | SystemModelMessage[];
      if (providerType === "anthropic") {
        const anthropicBlocks: SystemModelMessage[] = [];
        if (stableContent) {
          anthropicBlocks.push({
            role: "system" as const,
            content: stableContent,
            providerOptions: {
              anthropic: { cacheControl: { type: "ephemeral" } },
            },
          });
        }
        if (dynamicContent) {
          anthropicBlocks.push({
            role: "system" as const,
            content: dynamicContent,
          });
        }
        systemParam = anthropicBlocks.length > 0 ? anthropicBlocks : "";
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
      const scenarioTimeline = roundContext.snapshot.scenario.raw.scenarioTimeline;
      const multiTurnMessages = await horizonService.formatHorizonText(
        view,
        percept,
        imageConfig,
        scenarioTimeline,
      );

      if ((this.config.debugLevel ?? 0) >= 3) {
        this.logger.debug(
          `[${percept.traceId}] system_stable_bytes=${Buffer.byteLength(stableContent, "utf8")} system_dynamic_bytes=${Buffer.byteLength(dynamicContent, "utf8")} provider=${providerType ?? "unknown"} stableSignature=${stableSignature}`,
        );
      }

      const sectionNames = sections.map((section) => section.name).join("|");
      this.logger.debug(
        `[${percept.traceId}] emitPromptBlocks sections=${sectionNames} stableSignature=${stableSignature}`,
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
        `[loop] [${percept.traceId}] system_bytes=${Buffer.byteLength(systemPromptString, "utf8")} user_bytes=${totalUserBytes} messages=${multiTurnMessages.length}`,
      );

      this.logger.info(
        `[${percept.traceId}] tools=${toolPromptFragments.length > 0 ? "fragments" : "none"}`,
      );

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
              const wrapSettlement = collectRoundSettlement(
                wrapParsed.data.actions,
                wrapToolResults,
                pluginService,
              );
              mergeSettlementCounters(actionCounters, wrapSettlement.actions);
              mergeSettlementCounters(toolCounters, wrapSettlement.toolCalls);
              producedVisibleOutput ||= wrapSettlement.producedVisibleOutput;
              incidents.push(...wrapSettlement.incidents);
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

  private syncLoadedSkillsFromLegacyCompat(
    updatedSkills: NonNullable<ToolExecutionContext["skills"]>,
    current: LoadedSkillSet,
    skillCatalog: SkillRegistry | undefined,
  ): LoadedSkillSet {
    const updatedNames = new Set(updatedSkills.map((skill) => skill.name));

    for (const existingName of current.getLoadedNames()) {
      if (!updatedNames.has(existingName)) {
        current.unload(existingName);
      }
    }

    for (const skill of updatedSkills) {
      if (current.has(skill.name)) continue;
      if (!skillCatalog) {
        current.recordLoadAttempt(skill.name, "not_found", "skill catalog unavailable");
        continue;
      }

      const definition = skillCatalog.get(skill.name);
      if (!definition) {
        current.recordLoadAttempt(
          skill.name,
          "not_found",
          `skill "${skill.name}" not found in catalog`,
        );
        continue;
      }

      current.load(definition);
    }

    return current;
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

          try {
            const result = await pluginService.invoke(action.name, params, toolCtx);

            // After hook
            if (hookService) {
              await hookService.executeAfter(HookType.Tool, params, result, percept.traceId);
            }

            return result;
          } catch (error) {
            if (hookService) {
              await hookService.executeError(
                HookType.Tool,
                params,
                error instanceof Error ? error : new Error(String(error)),
                percept.traceId,
              );
            }
            throw error;
          }
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

function toActiveSkills(skills: SkillDefinition[]): ActiveSkill[] {
  return skills.map((skill) => ({
    name: skill.name,
    effects: [
      ...(skill.effects.prompt ? ["prompt"] : []),
      ...(skill.effects.style ? ["style"] : []),
      ...(skill.effects.tools ? ["tools"] : []),
    ],
    metadata: skill.description ? { description: skill.description } : undefined,
  }));
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

async function emitPromptBlocksCompat(
  promptService: PromptService,
  scope: Record<string, unknown>,
): Promise<{
  sections: RenderedPromptSection[];
  stableBlock: string;
  dynamicBlock: string;
  stableSignature: string;
}> {
  const legacyPromptService = promptService as PromptService & {
    render?: (
      templateName: string,
      initialScope?: Record<string, unknown>,
    ) => Promise<Array<RenderedPromptSection & { cacheable?: boolean }>>;
  };

  if (typeof legacyPromptService.render !== "function") {
    return {
      sections: [],
      stableBlock: "",
      dynamicBlock: "",
      stableSignature: createHash("sha256").update("", "utf8").digest("hex"),
    };
  }

  const renderedSections = await legacyPromptService.render("system", scope);
  const sections = renderedSections.map((section) => ({
    ...section,
    cacheable: section.cacheable ?? (section.name !== "extra" && section.name !== "situation"),
  }));

  const stableSections = sections.filter((section) => section.cacheable !== false);
  const dynamicSections = sections.filter((section) => section.cacheable === false);
  const stableBlock = stableSections.map((section) => section.content).join("\n\n");
  const dynamicBlock = dynamicSections.map((section) => section.content).join("\n\n");
  const stableSignature = createHash("sha256").update(stableBlock, "utf8").digest("hex");

  return {
    sections,
    stableBlock,
    dynamicBlock,
    stableSignature,
  };
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
