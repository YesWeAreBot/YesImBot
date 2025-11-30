import type { Context } from "koishi";
import type { ModeResult } from "./types";
import type { HorizonService } from "@/services/horizon/service";
import type { Percept, UserMessagePercept } from "@/services/horizon/types";
import { PerceptType } from "@/services/horizon/types";
import { Services } from "@/shared";
import { BaseChatMode } from "./base";

export class DefaultChatMode extends BaseChatMode {
    name = "default-chat";
    priority = 100; // 最低优先级，兜底

    constructor(ctx: Context, private horizon: HorizonService) {
        super(ctx);
        this.registerTemplates();
    }

    registerTemplates(): void {
        const promptService = this.ctx[Services.Prompt];
        promptService.registerTemplate("agent.system.chat.default", "你是一个友好且乐于助人的AI助手。根据用户的消息和历史对话，提供有用且相关的回答。");
        promptService.registerTemplate("agent.user.chat", "{content}");
    }

    match(percept: Percept): boolean {
        return percept.type === PerceptType.UserMessage;
    }

    async buildContext(percept: UserMessagePercept): Promise<ModeResult> {
        const { scope } = percept;
        const entries = await this.horizon.events.query({
            scope,
            limit: 20,
            orderBy: "desc",
        });

        return {
            view: {
                mode: "casual-chat",
                percept,
                self: await this.horizon.getSelfInfo(scope),
                history: this.horizon.events.toObservations(entries),
                environment: await this.horizon.getEnvironment(scope),
                entities: await this.horizon.getEntities({ scope }),
            },
            templates: {
                system: "agent.system.chat.default",
                user: "agent.user.chat",
            },
        };
    }
}
