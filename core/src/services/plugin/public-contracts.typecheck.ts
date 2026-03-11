import type {
  AgentEndHookExecutionContext,
  AgentStartHookExecutionContext,
  HookExecutionContext,
} from "../hook/types";
import type { AgentEndSummary, Capabilities, RoundContext, Scenario } from "../runtime/contracts";
import type { ToolExecutionContext } from "./types";

type Assert<T extends true> = T;

type ToolHasScenario = "scenario" extends keyof ToolExecutionContext ? true : false;
type ToolHasCapabilities = "capabilities" extends keyof ToolExecutionContext ? true : false;
type ToolHasRoundContext = "roundContext" extends keyof ToolExecutionContext ? true : false;

type _ToolFieldsExist = Assert<ToolHasScenario & ToolHasCapabilities & ToolHasRoundContext>;

type ToolScenarioType = ToolExecutionContext extends { scenario?: infer T } ? T : never;
type ToolCapabilitiesType = ToolExecutionContext extends { capabilities?: infer T } ? T : never;
type ToolRoundContextType = ToolExecutionContext extends { roundContext?: infer T } ? T : never;

type _ToolScenarioCanonical = Assert<
  [ToolScenarioType] extends [Scenario | undefined] ? true : false
>;
type _ToolCapabilitiesCanonical = Assert<
  [ToolCapabilitiesType] extends [Capabilities | undefined] ? true : false
>;
type _ToolRoundContextCanonical = Assert<
  [ToolRoundContextType] extends [RoundContext | undefined] ? true : false
>;

type _HookExtendsTool = Assert<HookExecutionContext extends ToolExecutionContext ? true : false>;

type _AgentStartExtendsHook = Assert<
  AgentStartHookExecutionContext extends HookExecutionContext ? true : false
>;
type _AgentEndExtendsHook = Assert<
  AgentEndHookExecutionContext extends HookExecutionContext ? true : false
>;

type _AgentStartRoundContextCanonical = Assert<
  [AgentStartHookExecutionContext["roundContext"]] extends [RoundContext] ? true : false
>;
type _AgentEndRoundContextCanonical = Assert<
  [AgentEndHookExecutionContext["roundContext"]] extends [RoundContext] ? true : false
>;
type _AgentEndSummaryCanonical = Assert<
  [AgentEndHookExecutionContext["endSummary"]] extends [AgentEndSummary] ? true : false
>;

export {};
