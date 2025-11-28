import type { Context } from "koishi";
import type { Mode, ModeResult } from "./types";
import type { HorizonService } from "@/services/horizon/service";
import type { Percept, UserMessagePercept } from "@/services/horizon/types";
import { PerceptType } from "@/services/horizon/types";

export class DefaultChatMode implements Mode {
    name = "default-chat";
    priority = 100; // 最低优先级，兜底

    constructor(private ctx: Context, private horizon: HorizonService) {}

    match(percept: Percept): boolean {
        // 只要是用户消息就匹配
        return percept.type === PerceptType.UserMessage;
    }

    async buildContext(percept: UserMessagePercept, ctx: Context): Promise<ModeResult> {
        const scopeId = percept.scopeId;

        const entries = await this.horizon.events.query({
            scopeId,
            limit: 20,
            orderBy: "desc",
        });

        return {
            view: {
                mode: "casual-chat",
                percept,
                self: await this.horizon.getSelfInfo(),
                history: this.horizon.events.toObservations(entries),
                environment: await this.horizon.getEnvironment(scopeId),
                entities: await this.horizon.getEntities({ scopeId }),
            },
            templates: {
                system: "agent.system.chat.default",
                user: "agent.user.chat",
            },
        };
    }
}
