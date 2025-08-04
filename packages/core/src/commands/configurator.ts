import { Context, Service, Session, Time, clone } from "koishi";

import { PersonalityPresets } from "@/agent";
import { Config } from "@/config";
import { PROVIDER_TYPES, TaskType } from "@/services/model";

// 定义每一步配置的结构
interface SetupStep {
    key: string; // 配置项的路径, e.g., 'agentBehavior.willingness.lifecycle.probabilityThreshold'
    title: string; // 这一步的标题
    description: string; // 详细可爱的描述
    // 核心交互函数，负责提示、接收、验证和更新临时配置
    handler: (session: Session, tempConfig: any) => Promise<boolean>;
    // 条件渲染函数，如果返回 false，则跳过此步骤
    shouldShow?: (tempConfig: any) => boolean;
}

// 可爱的助手类，管理整个配置流程
export class ConfiguratorService extends Service {
    // 使用 Map 来管理不同用户的配置会话，防止多用户同时配置时冲突
    private activeSessions = new Map<string, SetupSessionState>();

    constructor(ctx: Context) {
        // 服务名，以及声明它不是一个需要在 dispose 时自动停止的服务
        super(ctx, "configurator", true);

        // 注册主命令
        ctx.command("setup", "进入交互式配置向导", { authority: 3 }).action(async ({ session }) => {
            // 1. 首先生成一个验证码，用户提交验证码进入后续流程
            const captcha = Math.random().toString(36).substring(2, 8).toUpperCase();

            await session.send(`(｡･ω･｡)ﾉ♡ 主人，为了确认是你本人在操作，请输入下面的验证码哦：\n\`\`\`\n${captcha}\n\`\`\``);

            // 2. 监听用户的回复，验证验证码
            const response = await session.prompt(60 * 1000); // 60秒超时
            if (!response) {
                await session.send("呜...超时了哦，请重新发送命令以重试。");
                return;
            }
            if (response.toUpperCase() !== captcha) {
                await session.send("验证码错误，请重新发送命令以重试。");
                return;
            }

            // 3. 验证通过后，将流程交给我们的服务来处理
            await this.startSession(session);
        });
    }

    // 开始一个新的配置会话
    public async startSession(session: Session) {
        const sessionId = `${session.platform}:${session.channelId}:${session.userId}`;
        if (this.activeSessions.has(sessionId)) {
            await session.send("诶？你已经在配置流程中了哦！如果想重新开始，请先输入 `/q` 退出当前的配置。");
            return;
        }

        // 从当前插件作用域获取最新配置
        const initialConfig = clone(this.ctx.scope.config);
        const state = new SetupSessionState(this.ctx, session, initialConfig);
        this.activeSessions.set(sessionId, state);

        await session.send(`(ﾉ´ヮ´)ﾉ*:･ﾟ✧ 欢迎来到交互式配置向导！我是你的专属助手哦~
接下来我会一步步引导你完成配置。随时可以使用下面的命令控制流程哦：
- /n 或 /next: 跳到下一个配置项
- /p 或 /prev: 返回上一个配置项
- /s 或 /save: 保存当前进度并应用配置！
- /q 或 /quit: 放弃所有更改并退出配置

那么，我们开始吧！`);

        try {
            await this.runInteractionLoop(sessionId);
        } finally {
            // 无论循环如何结束（保存、退出、错误），都清理会话
            this.activeSessions.delete(sessionId);
        }
    }

    private async runInteractionLoop(sessionId: string) {
        const state = this.activeSessions.get(sessionId);
        if (!state) return;

        while (state.currentStep < state.steps.length) {
            const step = state.steps[state.currentStep];

            // 检查是否应该显示此步骤
            if (step.shouldShow && !step.shouldShow(state.tempConfig)) {
                state.currentStep++;
                continue;
            }

            // 显示进度
            await state.session.send(`--- 步骤 ${state.currentStep + 1} / ${state.steps.length} ---`);
            const success = await step.handler(state.session, state.tempConfig);

            // 处理导航命令
            const navAction = state.getNavAction();
            if (navAction) {
                state.clearNavAction();
                switch (navAction) {
                    case "quit":
                        await state.session.send("好的，已经放弃所有更改，配置向导已退出。下次再见啦~ ( ´ ▽ ` )ﾉ");
                        return;
                    case "save":
                        await this.saveConfig(state);
                        return;
                    case "prev":
                        // 寻找上一个可见的步骤
                        do {
                            state.currentStep = Math.max(0, state.currentStep - 1);
                        } while (
                            state.steps[state.currentStep].shouldShow &&
                            !state.steps[state.currentStep].shouldShow(state.tempConfig) &&
                            state.currentStep > 0
                        );
                        continue;
                    case "next":
                        state.currentStep++;
                        continue;
                }
            }

            // 如果 handler 成功处理，则自动进入下一步
            if (success) {
                state.currentStep++;
            }
            // 如果 handler 返回 false (通常是用户输入了无效内容)，则停留在当前步骤，循环会重新执行 handler
        }

        // 所有步骤完成后
        await state.session.send("耶！所有配置项都过了一遍了哦！(o´▽`o)💖");
        await this.confirmAndSave(state);
    }

    private async saveConfig(state: SetupSessionState) {
        await state.session.send("正在保存配置... 请稍等一下哦~");
        try {
            // 更新配置
            this.ctx.scope.update(state.tempConfig);
            await state.session.send("配置已保存！部分更改可能需要重启插件才能完全生效。");
        } catch (error) {
            this.ctx.logger.error("保存配置失败:", error);
            await state.session.send(`呜哇！(｡•́︿•̀｡) 保存配置的时候出错了... 错误信息已经记录在日志里了。`);
        }
    }

    private async confirmAndSave(state: SetupSessionState) {
        const config = state.tempConfig;
        const previewLines = [];

        // --- Helper to build the text ---
        const addLine = (text: string, indent = 0) => {
            previewLines.push("  ".repeat(indent) + text);
        };

        previewLines.push("✨ 这是为你生成的配置摘要 ✨");
        previewLines.push("==========================");

        // 1. AI 模型服务
        addLine("🧠 **AI 模型服务**");
        const providers = config.modelService?.providers || [];
        addLine(`服务商 (${providers.length}个):`, 1);
        if (providers.length > 0) {
            providers.forEach((p) => addLine(`- ${p.name} (${p.type}): ${p.models?.length || 0}个模型`, 2));
        } else {
            addLine("- (未配置)", 2);
        }

        const groups = config.modelService?.modelGroups || [];
        addLine(`模型组 (${groups.length}个):`, 1);
        if (groups.length > 0) {
            groups.forEach((g) => {
                const modelNames = g.models.map((m) => m.modelId).join(", ");
                addLine(`- ${g.name}: [${modelNames}]`, 2);
            });
        } else {
            addLine("- (未配置)", 2);
        }

        const tasks = config.modelService?.task || {};
        addLine("任务分配:", 1);
        addLine(`- 聊天: ${tasks[TaskType.Chat] || "(未分配)"}`, 2);
        addLine(`- 总结: ${tasks[TaskType.Summarization] || "(未分配)"}`, 2);

        previewLines.push(""); // Spacer

        // 2. 智能体行为
        addLine("🎭 **智能体行为**");
        const personalityKey = config.agentBehavior?.willingness?.personality || "default";
        // 确保 PersonalityPresets 在此作用域内可用
        const personalityName = PersonalityPresets[personalityKey]?.name || "未知";
        addLine(`性格预设: ${personalityName} (\`${personalityKey}\`)`, 1);

        const visionEnabled = config.agentBehavior?.vision?.enabled;
        addLine(`视觉能力: ${visionEnabled ? "✅ 开启" : "❌ 关闭"}`, 1);

        const allowedChannels = config.agentBehavior?.arousal?.allowedChannels || [];
        addLine(`响应频道 (${allowedChannels.length}个):`, 1);
        if (allowedChannels.length > 0) {
            allowedChannels.slice(0, 3).forEach((c) => addLine(`- ${c.platform}:${c.id}`, 2));
            if (allowedChannels.length > 3) addLine(`- ...等 ${allowedChannels.length - 3} 个更多频道`, 2);
        } else {
            addLine("- (未配置, 可能在所有频道响应)", 2);
        }

        previewLines.push(""); // Spacer

        // 3. 核心能力
        addLine("🛠️ **核心能力**");
        const historyEnabled = config.capabilities?.history?.summarization.enabled;
        addLine(`历史总结: ${historyEnabled ? "✅ 开启" : "❌ 关闭"}`, 1);
        if (historyEnabled) {
            addLine(`触发阈值: 每 ${config.capabilities.history.summarization.triggerCount} 段对话`, 2);
        }
        addLine(`核心记忆路径: ${config.capabilities?.memory?.coreMemoryPath || "(未设置)"}`, 1);
        addLine(`图片存储路径: ${config.assetService?.storagePath || "(未设置)"}`, 1);

        // --- Send the final message ---
        // 使用 markdown 代码块来保留格式
        const previewText = previewLines.join("\n");
        await state.session.send(`这是你最终的配置预览，请检查一下哦：\n\`\`\`md\n${previewText}\n\`\`\``);

        await state.session.send(`确认要保存这份配置吗？(y/n) 或者直接输入 /s 保存, /q 退出。`);

        const finalConfirm = await state.session.prompt();
        if (!finalConfirm) {
            await state.session.send("等了太久没有回应，操作已取消。所有更改都已放弃了哦。");
            return;
        }

        if (finalConfirm.toLowerCase() === "y" || finalConfirm.toLowerCase() === "/s" || finalConfirm.toLowerCase() === "s") {
            await this.saveConfig(state);
        } else {
            await state.session.send("好的，已经放弃所有更改，配置向导已退出。下次再见啦~ ( ´ ▽ ` )ﾉ");
        }
    }
}

// 帮助我们管理单个用户会话的状态
class SetupSessionState {
    public tempConfig: Config;
    public currentStep = 0;
    public steps: SetupStep[];
    private navAction: "next" | "prev" | "save" | "quit" | null = null;

    constructor(
        public ctx: Context,
        public session: Session,
        initialConfig: Config
    ) {
        this.tempConfig = initialConfig;
        // 在这里定义我们所有的配置步骤！
        this.steps = [
            // --- 模块一: AI 模型配置 (大脑核心) ---
            {
                key: "modelService.providers",
                title: "🧠 AI模型提供商",
                description: `这里是配置我的“大脑”来源的地方！你需要告诉我从哪里获取AI模型。\n请逐个添加提供商，每次添加请按格式发送：\`名称,类型,API密钥[,基础URL]\` (基础URL是可选的)\n例如: \`my_openai,OpenAI,sk-xxxxxxxxxxxx\`\n或 \`my_ollama,Ollama,nokey,http://localhost:11434\`\n\n支持的类型有: ${PROVIDER_TYPES.join(
                    ", "
                )}\n\n添加完一个后我会问你是否继续。准备好后请发送第一个提供商的信息，或者输入 \`/n\` 跳过。`,
                handler: this.createProviderHandler(),
            },
            {
                key: "modelService.modelGroups",
                title: "🧩 创建模型组",
                description:
                    "模型组可以将多个模型打包，用于任务分配或故障转移。接下来我们来创建模型组吧！\n你可以将不同提供商的模型混合在一起哦。",
                handler: this.createModelGroupHandler(),
                shouldShow: (config) => config.modelService?.providers?.length > 0,
            },
            {
                key: "modelService.task.chat",
                title: "💬 主要聊天任务模型",
                description: "请选择一个模型组用于日常的聊天对话。这是我最核心的功能哦！",
                handler: this.createChoiceHandler({
                    getChoices: (config) => config.modelService.modelGroups.map((g) => ({ value: g.name, description: g.name })),
                }),
                shouldShow: (config) => config.modelService?.modelGroups?.length > 0,
            },
            {
                key: "modelService.task.summarization",
                title: "📜 对话总结任务模型",
                description: "当对话历史太长时，我会进行总结。请选择一个模型组来执行这个任务。通常选一个便宜又快速的模型就好啦~",
                handler: this.createChoiceHandler({
                    getChoices: (config) => config.modelService.modelGroups.map((g) => ({ value: g.name, description: g.name })),
                }),
                shouldShow: (config) => config.modelService?.modelGroups?.length > 0,
            },

            // --- 模块二: 智能体行为 (性格与响应) ---
            {
                key: "agentBehavior.willingness.personality",
                title: "🎭 选择AI性格",
                description: "你想让我成为什么样的AI呢？选择一个预设的性格，这会决定我的发言频率和风格哦！",
                handler: this.createChoiceHandler({
                    getChoices: () =>
                        Object.entries(PersonalityPresets).map(([key, preset]) => ({
                            value: key,
                            description: preset.name,
                        })),
                }),
            },
            {
                key: "agentBehavior.arousal.allowedChannelGroups",
                title: "📡 响应频道设置",
                description:
                    "我应该在哪些频道里活动呢？请逐一添加允许我发言的频道。\n格式是 `平台名:频道ID`，例如 `onebot:12345678`。\n一行一个，输入 `done` 或 `完成` 结束。",
                handler: this.createAllowedChannelsHandler(),
            },
            {
                key: "agentBehavior.vision.enabled",
                title: "😎 视觉能力开关",
                description: "要不要让我拥有看见图片的能力呢？开启后我就可以理解你发的图片内容啦！(y/n)",
                handler: this.createBooleanHandler(),
            },
            {
                key: "agentBehavior.heartbeat",
                title: "💓 对话心跳次数",
                description: "这决定了在一轮对话中，我最多能连续思考和行动多少次（例如调用工具）。建议值为 3-5。",
                handler: this.createNumberHandler({ min: 1, max: 10 }),
            },
            {
                key: "agentBehavior.timeout",
                title: "⏱️ 对话超时时间",
                description: "如果我思考太久没有回应，系统会自动中断。设置一个超时时间（秒）吧！建议值为 60-120 秒。",
                handler: this.createNumberHandler({ min: 10, max: 180 }),
            },

            // --- 模块三: 核心能力配置 ---
            {
                key: "capabilities.history.enableSummarization",
                title: "📚 启用历史总结",
                description: "要不要我拥有“长期记忆”？开启后，我会自动总结旧的聊天记录，这样就能记住更久远的事情啦！(y/n)",
                handler: this.createBooleanHandler(),
            },
            {
                key: "capabilities.history.summarizationTriggerCount",
                title: "📈 历史总结阈值",
                description: "当有多少段对话没有被总结时，就触发一次总结任务？数字越小，总结越频繁。建议值为 5-10。",
                handler: this.createNumberHandler({ min: 2, max: 20 }),
                shouldShow: (config) => config.capabilities?.history?.enableSummarization,
            },
            {
                key: "capabilities.memory.coreMemoryPath",
                title: "🗂️ 核心记忆路径",
                description: "我可以加载一些核心记忆文件（.md格式），这些是我永远不会忘记的“设定”。请提供存放这些文件的目录路径。",
                handler: this.createStringHandler({ placeholder: "data/yesimbot/memory/core" }),
            },
            {
                key: "imageService.storagePath",
                title: "🖼️ 图片存储路径",
                description: "聊天中收到的图片需要保存在一个地方才能被我“看见”。请提供一个本地存储路径。",
                handler: this.createStringHandler({ placeholder: "data/yesimbot/images" }),
            },
        ];
    }

    // --- Getter/Setter & Helpers ---

    private getProperty(obj: any, path: string, defaultValue: any = undefined) {
        return path.split(".").reduce((acc, part) => acc && acc[part], obj) ?? defaultValue;
    }

    private setProperty(obj: any, path: string, value: any) {
        const keys = path.split(".");
        const lastKey = keys.pop()!;
        const target = keys.reduce((acc, part) => {
            if (typeof acc[part] === "undefined" || acc[part] === null) {
                acc[part] = {};
            }
            return acc[part];
        }, obj);
        target[lastKey] = value;
    }

    public setNavAction(action: "next" | "prev" | "save" | "quit") {
        this.navAction = action;
    }
    public getNavAction() {
        return this.navAction;
    }
    public clearNavAction() {
        this.navAction = null;
    }

    async promptWithCommands(session: Session, timeout = Time.minute): Promise<string> {
        while (true) {
            const input = await session.prompt(timeout);

            if (!input) {
                await session.send("呜...等了你好久哦...配置向导已自动退出。所有更改都已放弃了哦。下次再来吧！");
                this.setNavAction("quit");
                return "";
            }

            const cmd = input.toLowerCase().trim();
            if (["/n", "n", "next", "/next"].includes(cmd)) {
                this.setNavAction("next");
                return "";
            }
            if (["/p", "p", "prev", "/prev"].includes(cmd)) {
                this.setNavAction("prev");
                return "";
            }
            if (["/s", "s", "save", "/save"].includes(cmd)) {
                this.setNavAction("save");
                return "";
            }
            if (["/q", "q", "quit", "/quit"].includes(cmd)) {
                this.setNavAction("quit");
                return "";
            }

            return input;
        }
    }

    // --- Handler 工厂函数，减少重复代码 ---

    private createStringHandler(options: { placeholder?: string } = {}): SetupStep["handler"] {
        return async (session, tempConfig) => {
            const step = this.steps[this.currentStep];
            const currentValue = this.getProperty(tempConfig, step.key);

            /* prettier-ignore */
            await session.send(`${step.title}\n${step.description}\n当前值是: \`${currentValue || "未设置"}\`${options.placeholder ? ` (推荐: ${options.placeholder})` : ""}\n请输入新的值，或者输入 \`/n\` 跳过。`);
            const input = await this.promptWithCommands(session);
            if (this.navAction) return true;

            this.setProperty(tempConfig, step.key, input);
            await session.send(`好哦！${step.title} 已设置为 \`${input}\`！`);
            return true;
        };
    }

    private createNumberHandler(options: { min?: number; max?: number } = {}): SetupStep["handler"] {
        return async (session, tempConfig) => {
            const step = this.steps[this.currentStep];
            const currentValue = this.getProperty(tempConfig, step.key);

            await session.send(`${step.title}\n${step.description}\n当前值是: \`${currentValue}\`\n请输入新的数值，或者输入 \`/n\` 跳过。`);

            while (true) {
                const input = await this.promptWithCommands(session);
                if (this.navAction) return true;

                const num = parseFloat(input);
                if (isNaN(num)) {
                    await session.send("呜...这好像不是一个数字哦，请重新输入啦。");
                    continue;
                }
                if (options.min !== undefined && num < options.min) {
                    await session.send(`数值不能小于 ${options.min} 哦，请重新输入~`);
                    continue;
                }
                if (options.max !== undefined && num > options.max) {
                    await session.send(`数值不能大于 ${options.max} 哦，请重新输入~`);
                    continue;
                }

                this.setProperty(tempConfig, step.key, num);
                await session.send(`好哦！${step.title} 已设置为 \`${num}\`！`);
                return true;
            }
        };
    }

    private createBooleanHandler(): SetupStep["handler"] {
        return async (session, tempConfig) => {
            const step = this.steps[this.currentStep];
            const currentValue = this.getProperty(tempConfig, step.key, false);

            /* prettier-ignore */
            await session.send(`${step.title}\n${step.description}\n当前是: \`${currentValue ? "✅ 开启" : "❌ 关闭"}\`\n请输入 'y' (开启) 或 'n' (关闭)，或者输入 \`/n\` 跳过。`);

            while (true) {
                const input = (await this.promptWithCommands(session)).toLowerCase();
                if (this.navAction) return true;

                if (["y", "yes", "开启", "on"].includes(input)) {
                    this.setProperty(tempConfig, step.key, true);
                    await session.send(`好哒！${step.title} 已设为 \`✅ 开启\`！`);
                    return true;
                } else if (["n", "no", "关闭", "off"].includes(input)) {
                    this.setProperty(tempConfig, step.key, false);
                    await session.send(`了解！${step.title} 已设为 \`❌ 关闭\`！`);
                    return true;
                } else {
                    await session.send("诶...听不懂呢，请输入 `y` 或者 `n` 啦！");
                }
            }
        };
    }

    private createChoiceHandler(options: { getChoices: (config: any) => { value: string; description: string }[] }): SetupStep["handler"] {
        return async (session, tempConfig) => {
            const step = this.steps[this.currentStep];
            const currentValue = this.getProperty(tempConfig, step.key);
            const choices = options.getChoices(tempConfig);

            if (choices.length === 0) {
                await session.send(
                    `(T_T) 呜...在为 "${step.title}" 配置时，发现没有可用选项。可能是前置步骤（如添加模型提供商）没有完成。我先跳过这一步了哦。`
                );
                return true;
            }

            const choicesText = choices.map((c, i) => `${i + 1}. ${c.description} (\`${c.value}\`)`).join("\n");
            await session.send(
                `${step.title}\n${step.description}\n当前选择是: \`${
                    currentValue || "未设置"
                }\`\n请从下面选择一个 (输入序号或\`值\`)：\n${choicesText}`
            );

            while (true) {
                const input = await this.promptWithCommands(session);
                if (this.navAction) return true;

                const choiceIndex = parseInt(input, 10) - 1;
                let selectedChoice = null;

                if (!isNaN(choiceIndex) && choiceIndex >= 0 && choiceIndex < choices.length) {
                    selectedChoice = choices[choiceIndex];
                } else {
                    selectedChoice = choices.find((c) => c.value === input);
                }

                if (selectedChoice) {
                    this.setProperty(tempConfig, step.key, selectedChoice.value);
                    await session.send(`好耶！${step.title} 已选择 \`${selectedChoice.description}\`！`);
                    return true;
                } else {
                    await session.send("诶...没有找到这个选项哦，请重新输入正确的序号或值~");
                }
            }
        };
    }

    // --- 自定义复杂 Handler ---

    private createProviderHandler(): SetupStep["handler"] {
        return async (session, tempConfig) => {
            const path = "modelService.providers";
            const currentProviders = this.getProperty(tempConfig, path, []);
            let newProviders = [...currentProviders];

            if (currentProviders.length > 0) {
                const providerList = currentProviders.map((p) => `- ${p.name} (${p.type})`).join("\n");
                await session.send(
                    `当前已配置的提供商：\n${providerList}\n你可以继续添加，输入 \`clear\` 清空，或输入 \`done\` 完成此步骤。`
                );
            } else {
                await session.send(this.steps[this.currentStep].description);
            }

            while (true) {
                const input = await this.promptWithCommands(session);
                if (this.navAction) {
                    this.setProperty(tempConfig, path, newProviders);
                    return true;
                }
                if (input.toLowerCase() === "done" || input.toLowerCase() === "完成") break;
                if (input.toLowerCase() === "clear") {
                    newProviders = [];
                    await session.send("好哦，所有提供商都已清空。请添加第一个吧！");
                    continue;
                }

                const parts = input.split(",").map((p) => p.trim());
                if (parts.length < 3) {
                    await session.send("诶...格式好像不太对哦，至少需要 `名称,类型,API密钥` 啦，请重新输入~");
                    continue;
                }

                const [name, type, apiKey, baseURL] = parts;
                if (!PROVIDER_TYPES.includes(type as any)) {
                    await session.send(`类型 "${type}" 不支持哦！支持的类型有: ${PROVIDER_TYPES.join(", ")}。请重新输入~`);
                    continue;
                }

                // 检查名称是否重复
                if (newProviders.some((p) => p.name === name)) {
                    await session.send(`名称 "${name}" 已经存在了哦，换个名字吧~`);
                    continue;
                }

                // 添加模型。引导用户至少添加一个模型。
                await session.send(
                    `好的，添加了提供商 "${name}"！现在请为它添加至少一个模型 ID（例如 "gpt-4-turbo"）。一行一个，输入 \`done\` 结束。`
                );
                const models = [];
                while (true) {
                    const modelId = await this.promptWithCommands(session, 2 * Time.minute);
                    if (this.navAction) {
                        this.setProperty(tempConfig, path, newProviders);
                        return true;
                    }
                    if (modelId.toLowerCase() === "done" || modelId.toLowerCase() === "完成") {
                        if (models.length === 0) {
                            await session.send("至少要添加一个模型哦！");
                            continue;
                        }
                        break;
                    }
                    models.push({ modelId: modelId.trim(), abilities: ["Chat", "FunctionCalling"] }); // 使用默认能力
                    await session.send(`已添加模型 \`${modelId}\`。继续添加，或输入 \`done\` 完成。`);
                }

                newProviders.push({ name, type, apiKey, baseURL, models });
                this.setProperty(tempConfig, path, newProviders);

                await session.send(
                    `好耶！添加了提供商 "${name}" 及其模型！还要继续添加吗？(直接发送下一个提供商信息，或输入 \`done\` 完成)`
                );
            }
            await session.send("提供商配置完成！( •̀ ω •́ )y");
            return true;
        };
    }

    private createModelGroupHandler(): SetupStep["handler"] {
        return async (session, tempConfig) => {
            const path = "modelService.modelGroups";
            let currentGroups = this.getProperty(tempConfig, path, []);
            const allModels = this.getProperty(tempConfig, "modelService.providers", []).flatMap((p) =>
                p.models.map((m) => ({
                    providerName: p.name,
                    modelId: m.modelId,
                    displayName: `${p.name} / ${m.modelId}`,
                }))
            );

            if (allModels.length === 0) {
                await session.send("你还没有配置任何模型，无法创建模型组。请先返回上一步配置提供商和模型。");
                return true;
            }

            await session.send("现在我们来创建模型组。你可以随时输入 `done` 完成此步骤。");

            while (true) {
                await session.send("请输入新模型组的名称（例如 `fast-group`），或者输入 `done` 结束创建。");
                const groupName = await this.promptWithCommands(session);
                if (this.navAction) {
                    this.setProperty(tempConfig, path, currentGroups);
                    return true;
                }
                if (groupName.toLowerCase() === "done" || groupName.toLowerCase() === "完成") break;

                if (currentGroups.some((g) => g.name === groupName)) {
                    await session.send("这个组名已经存在了哦，换一个吧~");
                    continue;
                }

                const modelChoicesText = allModels.map((m, i) => `${i + 1}. ${m.displayName}`).join("\n");
                await session.send(
                    `好的，组名为 \`${groupName}\`。请从以下可用模型中选择要加入该组的模型，可以输入多个序号，用逗号或空格隔开（例如 "1, 3"）：\n${modelChoicesText}`
                );

                const selectedModels = [];
                while (true) {
                    const selectionInput = await this.promptWithCommands(session);
                    if (this.navAction) {
                        this.setProperty(tempConfig, path, currentGroups);
                        return true;
                    }

                    const indices = selectionInput
                        .split(/[, ]+/)
                        .map((s) => parseInt(s.trim(), 10) - 1)
                        .filter((n) => !isNaN(n));
                    const validSelections = indices.map((i) => allModels[i]).filter(Boolean);

                    if (validSelections.length === 0) {
                        await session.send("没有选择任何有效的模型哦，请重新输入序号。");
                        continue;
                    }

                    for (const model of validSelections) {
                        selectedModels.push({ providerName: model.providerName, modelId: model.modelId });
                    }
                    await session.send(`已将 ${validSelections.map((m) => `\`${m.displayName}\``).join(", ")} 加入组 \`${groupName}\`。`);
                    break;
                }

                currentGroups.push({ name: groupName, models: selectedModels });
                this.setProperty(tempConfig, path, currentGroups);
            }
            await session.send("模型组配置完成！(๑•̀ㅂ•́)و✧");
            return true;
        };
    }

    private createAllowedChannelsHandler(): SetupStep["handler"] {
        return async (session, tempConfig) => {
            const path = "agentBehavior.arousal.allowedChannelGroups";
            // 简化处理：我们只管理第一个组
            const currentGroup = this.getProperty(tempConfig, path, [[]])[0];
            let newGroup = [...currentGroup];

            await session.send(this.steps[this.currentStep].description);
            if (newGroup.length > 0) {
                const channels = newGroup.map((c) => `- ${c.platform}:${c.id}`).join("\n");
                await session.send(`当前已允许的频道:\n${channels}\n你可以继续添加，或输入 \`clear\` 清空。`);
            }

            while (true) {
                const input = await this.promptWithCommands(session);
                if (this.navAction) {
                    this.setProperty(tempConfig, path, [newGroup]);
                    return true;
                }
                if (input.toLowerCase() === "done" || input.toLowerCase() === "完成") break;
                if (input.toLowerCase() === "clear") {
                    newGroup = [];
                    await session.send("已清空，请添加新的频道。");
                    continue;
                }

                const parts = input.split(":");
                if (parts.length !== 2) {
                    await session.send("格式错误哦，应该是 `平台:频道ID` 这种格式。");
                    continue;
                }
                const [platform, id] = parts.map((s) => s.trim());
                newGroup.push({ platform, id });
                await session.send(`已添加频道 \`${platform}:${id}\`。继续添加，或输入 \`done\` 完成。`);
            }

            this.setProperty(tempConfig, path, [newGroup]);
            await session.send(`频道权限配置完成！辛苦啦~`);
            return true;
        };
    }
}
