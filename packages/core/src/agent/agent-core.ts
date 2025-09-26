import { Context, Service, Session } from "koishi";

import { Config } from "@/config";
import { ChatModelSwitcher, ModelService } from "@/services/model";
import { loadTemplate, PromptService } from "@/services/prompt";
import { AnyAgentStimulus, StimulusSource, UserMessageStimulus, WorldStateService } from "@/services/worldstate";
import { Services } from "@/shared/constants";
import { PromptContextBuilder } from "./context-builder";
import { HeartbeatProcessor } from "./heartbeat-processor";
import { WillingnessManager } from "./willing";

type WithDispose<T> = T & { dispose: () => void };

declare module "koishi" {
    interface Events {
        "after-send": (session: Session) => void;
    }
}

export class AgentCore extends Service<Config> {
    static readonly inject = [Services.Asset, Services.Memory, Services.Model, Services.Prompt, Services.Tool, Services.WorldState];

    // 依赖的服务
    private readonly worldState: WorldStateService;
    private readonly modelService: ModelService;
    private readonly promptService: PromptService;

    // 核心组件
    private willing: WillingnessManager;
    private contextBuilder: PromptContextBuilder;
    private processor: HeartbeatProcessor;

    private modelSwitcher: ChatModelSwitcher;

    private readonly runningTasks = new Set<string>();
    private readonly debouncedReplyTasks = new Map<string, WithDispose<(stimulus: AnyAgentStimulus) => void>>();
    private readonly deferredTimers = new Map<string, NodeJS.Timeout>();

    constructor(ctx: Context, config: Config) {
        super(ctx, Services.Agent, true);
        this.config = config;

        this.logger = this.ctx.logger("agent");

        this.logger.level = this.config.logLevel;

        this.worldState = this.ctx[Services.WorldState];
        this.modelService = this.ctx[Services.Model];
        this.promptService = this.ctx[Services.Prompt];

        this.modelSwitcher = this.modelService.useChatGroup(this.config.chatModelGroup);
        if (!this.modelSwitcher) {
            const notifier = ctx.notifier.create({
                type: "danger",
                content: `未给 '聊天 (Chat)' 任务类型配置任何模型组，请前往“模型服务”设置，并为 '聊天' 任务类型至少配置一个模型`,
            });
        }

        this.willing = new WillingnessManager(ctx, config);

        this.contextBuilder = new PromptContextBuilder(ctx, config, this.modelSwitcher);
        this.processor = new HeartbeatProcessor(
            ctx,
            config,
            this.modelSwitcher,
            ctx[Services.Prompt],
            ctx[Services.Tool],
            this.worldState.l1_manager,
            this.contextBuilder
        );
    }

    protected async start(): Promise<void> {
        this._registerPromptTemplates();

        this.ctx.on("agent/stimulus-message", (stimulus: UserMessageStimulus) => {
            const { session, platform, channelId } = stimulus.payload;

            const channelCid = `${platform}:${channelId}`;

            let decision = false;

            try {
                const willingnessBefore = this.willing.getCurrentWillingness(channelCid);
                const result = this.willing.shouldReply(session);
                const willingnessAfter = this.willing.getCurrentWillingness(channelCid); // 获取衰减后的值
                decision = result.decision;

                /* prettier-ignore */
                this.logger.debug(`[${channelCid}] 意愿计算: ${willingnessBefore.toFixed(2)} -> ${willingnessAfter.toFixed(2)} | 回复概率: ${(result.probability * 100).toFixed(1)}% | 初步决策: ${decision}`);
            } catch (error: any) {
                this.logger.error(`计算意愿值失败，已阻止本次响应: ${error.message}`);
                return;
            }

            if (!decision) {
                return;
            }

            if (this.worldState.isBotMuted(channelCid)) {
                this.logger.warn(`[${channelCid}] 机器人已被禁言，响应终止。`);
                return;
            }

            this.schedule(stimulus);
        });

        this.willing.startDecayCycle();
    }

    protected stop(): void {
        this.debouncedReplyTasks.forEach((task) => task.dispose());
        this.deferredTimers.forEach((timer) => clearTimeout(timer));
        this.willing.stopDecayCycle();
    }

    private _registerPromptTemplates(): void {
        // 注册所有可重用的局部模板
        this.promptService.registerTemplate("agent.partial.world_state", loadTemplate("world_state"));
        this.promptService.registerTemplate("agent.partial.l1_history_item", loadTemplate("l1_history_item"));

        // 注册主模板
        this.promptService.registerTemplate("agent.system", this.config.systemTemplate);
        this.promptService.registerTemplate("agent.user", this.config.userTemplate);

        // 注册动态片段
        this.promptService.registerSnippet("agent.context.currentTime", () => new Date().toISOString());
    }

    public schedule(stimulus: AnyAgentStimulus): void {
        const { type, priority } = stimulus;

        if (type === StimulusSource.UserMessage) {
            const { session, platform, channelId } = stimulus.payload;
            const channelKey = `${platform}:${channelId}`;

            if (this.runningTasks.has(channelKey)) {
                this.logger.info(`[${channelKey}] 频道当前有任务在运行，跳过本次响应`);
                return;
            }

            const schedulingStack = new Error("Scheduling context stack").stack;

            // 将堆栈传递给任务
            this.getDebouncedTask(channelKey, schedulingStack)(stimulus);
        }
    }

    private getDebouncedTask(channelKey: string, schedulingStack?: string): WithDispose<(stimulus: UserMessageStimulus) => void> {
        let debouncedTask = this.debouncedReplyTasks.get(channelKey);
        if (!debouncedTask) {
            debouncedTask = this.ctx.debounce(async (stimulus: UserMessageStimulus) => {
                this.runningTasks.add(channelKey);
                this.logger.debug(`[${channelKey}] 锁定频道并开始执行任务`);
                try {
                    const { platform, channelId, session } = stimulus.payload;
                    const chatKey = `${platform}:${channelId}`;
                    this.willing.handlePreReply(chatKey);
                    const success = await this.processor.runCycle(stimulus);
                    if (success) {
                        const willingnessBeforeReply = this.willing.getCurrentWillingness(chatKey);
                        this.willing.handlePostReply(session, chatKey);
                        const willingnessAfterReply = this.willing.getCurrentWillingness(chatKey);
                        /* prettier-ignore */
                        this.logger.debug(`[${chatKey}] 回复成功，意愿值已更新: ${willingnessBeforeReply.toFixed(2)} -> ${willingnessAfterReply.toFixed(2)}`);
                    }
                } catch (error: any) {
                    this.logger.error(`调度任务执行失败 (Channel: ${channelKey}): ${error.message}`);
                } finally {
                    this.runningTasks.delete(channelKey);
                    this.logger.debug(`[${channelKey}] 频道锁已释放`);
                }
            }, this.config.debounceMs);
            this.debouncedReplyTasks.set(channelKey, debouncedTask);
        }
        return debouncedTask;
    }
}
