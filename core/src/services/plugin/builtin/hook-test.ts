import { Context, Logger } from "koishi";

import { Hook } from "../../hook/decorators";
import {
  AgentStartHookExecutionContext,
  BeforeHookResult,
  HookPhase,
  HookType,
} from "../../hook/types";
import { YesImPlugin } from "../plugin";

export class HookTestPlugin extends YesImPlugin {
  static inject = ["yesimbot.hook", "yesimbot.plugin", "yesimbot.horizon"];
  private logger: Logger;
  constructor(ctx: Context) {
    super(ctx);
    this.logger = ctx.logger("yesimbot.hook-test");
  }

  @Hook({
    type: HookType.Agent,
    phase: HookPhase.Before,
  })
  async testAgentStartHook(
    ctx: AgentStartHookExecutionContext,
  ): Promise<BeforeHookResult<AgentStartHookExecutionContext>> {
    this.logger.info("Agent start hook triggered");
    return {
      skip: true,
      result: "Agent execution skipped by hook",
    };
  }
}
