import type { HookExecutionContext } from "../hook/types";
import type { Capabilities, RoundContext, Scenario } from "../runtime/contracts";
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

export {};
