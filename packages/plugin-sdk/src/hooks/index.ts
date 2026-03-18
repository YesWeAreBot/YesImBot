import type { Context } from "koishi";

export { Hook } from "koishi-plugin-yesimbot/services/hook/decorators";
export {
  type AgentEndHookContext,
  type AgentEndHookExecutionContext,
  type AgentLifecycleHookExecutionContext,
  type AgentStartHookContext,
  type AgentStartHookExecutionContext,
  HookPhase,
  HookType,
  type BeforeHookResult,
  type HookExecutionContext,
  type HookContext,
  type HookDefinition,
  type HookHandler,
  type ToolAfterHookContext,
  type ToolBeforeHookContext,
  type ToolErrorHookContext,
} from "koishi-plugin-yesimbot/services/hook/types";

interface HookRuntimeRegistrar {
  register(
    ctx: Context,
    def: import("koishi-plugin-yesimbot/services/hook/types").HookDefinition,
  ): () => void;
}

type HookRuntimeContext = Context & {
  "yesimbot.hook"?: HookRuntimeRegistrar;
};

export function registerHook(
  ctx: Context,
  def: import("koishi-plugin-yesimbot/services/hook/types").HookDefinition,
): () => void {
  const hookService = (ctx as HookRuntimeContext)["yesimbot.hook"];
  if (!hookService) {
    throw new Error("yesimbot.hook service is not available on context");
  }
  return hookService.register(ctx, def);
}
