import type { Context } from "koishi";
import type { Mode, ModeResult } from "./types";
import type { Percept, UserMessagePercept } from "@/services/horizon/types";
import { PerceptType } from "@/services/horizon/types";
import { Services } from "@/shared/constants";

export class DefaultChatMode implements Mode {
    name = "default-chat";
    priority = 100; // 最低优先级，兜底

    match(percept: Percept): boolean {
        // 只要是用户消息就匹配
        return percept.type === PerceptType.UserMessage;
    }

    async buildContext(percept: UserMessagePercept, ctx: Context): Promise<ModeResult> {
        const horizon = ctx[Services.Horizon];
        const memory = ctx[Services.Memory];

        const scopeId = percept.scopeId;

        const entries = await horizon.events.query({
            scopeId,
            limit: 20,
            orderBy: "desc",
        });

        return {
            view: {
                mode: "casual-chat",
                percept,
                self: await horizon.getSelfInfo(),
                history: horizon.events.toObservations(entries),
                environment: await horizon.getEnvironment(scopeId),
                entities: await horizon.getEntities({ scopeId }),
            },
            templates: {
                system: "agent.system.chat.default",
                user: "agent.user.chat",
            },
        };
    }
}
