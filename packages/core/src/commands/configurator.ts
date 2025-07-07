import { Context, Service, Session, Time, deepEqual, sleep } from "koishi";
import { clone } from "cosmokit";

// 定义每一步配置的结构
interface SetupStep {
    key: string; // 配置项的路径, e.g., 'agentBehavior.willingness.threshold'
    title: string; // 这一步的标题
    description: string; // 详细可爱的描述
    // 核心交互函数，负责提示、接收、验证和更新临时配置
    handler: (session: Session, tempConfig: any) => Promise<boolean>;
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

    // 开始一个新的配置会M话
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

那么，我们开始吧！第一步是...`);

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
            const success = await step.handler(state.session, state.tempConfig);

            if (state.getNavAction() === "quit") {
                await state.session.send("好的，已经放弃所有更改，配置向导已退出。下次再见啦~ ( ´ ▽ ` )ﾉ");
                return;
            }
            if (state.getNavAction() === "save") {
                await this.saveConfig(state);
                return;
            }
            if (state.getNavAction() === "prev") {
                state.currentStep = Math.max(0, state.currentStep - 1);
                state.clearNavAction();
                continue;
            }
            if (state.getNavAction() === "next") {
                state.currentStep++;
                state.clearNavAction();
                continue;
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
            this.ctx.scope.update(state.tempConfig, false);
            await state.session.send("配置已更新！为了让所有更改生效，我需要进行一次完全重启... 这可能需要一点时间。");
            // 重新加载插件或整个应用
            this.ctx.loader.fullReload();
        } catch (error) {
            this.ctx.logger.error("保存配置失败:", error);
            await state.session.send(`呜哇！(｡•́︿•̀｡) 保存配置的时候出错了... 错误信息已经记录在日志里了。`);
        }
    }

    private async confirmAndSave(state: SetupSessionState) {
        // 使用 JSON.stringify 美化输出
        const configString = JSON.stringify(state.tempConfig, null, 2);

        // Koishi 对消息长度有限制，太长的配置需要分段发送
        const chunks = configString.match(/[\s\S]{1,1000}/g) || [];

        await state.session.send(`这是你最终的配置预览，请检查一下哦：`);

        // for (const chunk of chunks) {
        //     await state.session.send(`\`\`\`json\n${chunk}\n\`\`\``);
        //     await sleep(200); // 防止消息发送过快
        // }

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
    public tempConfig: any;
    public currentStep = 0;
    public steps: SetupStep[];
    private navAction: "next" | "prev" | "save" | "quit" | null = null;

    constructor(public ctx: Context, public session: Session, initialConfig: any) {
        this.tempConfig = initialConfig;
        // 在这里定义我们所有的配置步骤！
        this.steps = [
            // 示例：配置一个简单的数字
            {
                key: "agentBehavior.willingness.threshold",
                title: "✨ 响应意愿阈值",
                description:
                    "这个数值决定了我在什么情况下才会回复你哦~ 是一个 0 到 1 之间的小数，比如 0.5。数值越高，我就会变得越“高冷”，只有在更明确的指令下才会出现！",
                handler: this.createNumberHandler({ min: 0, max: 1 }),
            },
            // 示例：配置一个布尔值
            {
                key: "agentBehavior.vision.enabled",
                title: "😎 视觉能力开关",
                description: "要不要让我拥有看见图片的能力呢？开启后我就可以理解你发的图片内容啦！(y/n)",
                handler: this.createBooleanHandler(),
            },
            // 示例：配置一个字符串数组
            {
                key: "agentBehavior.willingness.keywords",
                title: "🔑 唤醒关键词",
                description: "除了@我之外，你还可以设置一些关键词来唤醒我哦！\n请一行一个地发送关键词，输入 `done` 或 `完成` 结束添加。",
                handler: this.createStringArrayHandler(),
            },
            // 示例：配置一个复杂的对象数组 (简化版)
            {
                key: "modelService.providers",
                title: "🧠 AI模型提供商",
                description: `这里是配置我的“大脑”来源的地方！你需要告诉我从哪里获取AI模型。\n请逐个添加提供商，每次添加请按格式发送：\`名称,类型,API密钥\`\n例如: \`my_openai,OpenAI,sk-xxxxxxxxxxxx\`\n类型可以是: OpenAI, Anthropic, Google Gemini, Ollama, OpenAI Compatible\n\n添加完一个后我会问你是否继续。准备好后请发送第一个提供商的信息，或者输入 \`/n\` 跳过。`,
                handler: async (session, tempConfig) => {
                    const path = "modelService.providers";

                    // 显示当前配置
                    const currentProviders = this.getProperty(tempConfig, path, []);
                    if (currentProviders.length > 0) {
                        await session.send(
                            `当前已配置的提供商：\n${currentProviders
                                .map((p) => ` - ${p.name} (${p.type})`)
                                .join("\n")}\n你可以继续添加，或者输入 \`/n\` 跳到下一步。`
                        );
                    } else {
                        await session.send("目前还没有配置任何提供商哦，请添加第一个吧！");
                    }

                    const newProviders = [...currentProviders];

                    while (true) {
                        const input = await this.promptWithCommands(session);
                        if (this.navAction) return true; // 如果是导航命令，直接返回
                        if (input.toLowerCase() === "done" || input.toLowerCase() === "完成") break;

                        const parts = input.split(",").map((p) => p.trim());
                        if (parts.length < 3) {
                            await session.send("诶...格式好像不太对哦，需要 `名称,类型,API密钥` 这种格式啦，请重新输入~");
                            continue;
                        }

                        const [name, type, apiKey] = parts;
                        // 基础验证
                        const validTypes = ["OpenAI", "Anthropic", "Google Gemini", "Ollama", "OpenAI Compatible"];
                        if (!validTypes.includes(type)) {
                            await session.send(`类型 "${type}" 不支持哦！支持的类型有: ${validTypes.join(", ")}。请重新输入~`);
                            continue;
                        }

                        newProviders.push({ name, type, apiKey, models: [] }); // 简化处理，models 留空
                        this.setProperty(tempConfig, path, newProviders);

                        await session.send(
                            `好耶！添加了提供商 "${name}"！还要继续添加吗？(直接发送下一个提供商信息，或输入 \`done\` 完成)`
                        );
                    }
                    await session.send("提供商配置完成！( •̀ ω •́ )y");
                    return true;
                },
            },
            // TODO: 在这里添加更多步骤来覆盖所有配置！
            // 例如 modelService.modelGroups, agentBehavior.arousal.allowedChannelGroups 等
            // allowedChannelGroups 会比较复杂，可以简化为引导用户输入 platform:id, 然后再分组
        ];
    }

    // --- Getter/Setter & Helpers ---

    // 方便地从深层对象获取属性
    private getProperty(obj: any, path: string, defaultValue: any = undefined) {
        return path.split(".").reduce((acc, part) => acc && acc[part], obj) ?? defaultValue;
    }

    // 方便地给深层对象设置属性
    private setProperty(obj: any, path: string, value: any) {
        const keys = path.split(".");
        const lastKey = keys.pop()!;
        const target = keys.reduce((acc, part) => {
            if (!acc[part]) acc[part] = {};
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

    // 带有命令处理的 prompt
    async promptWithCommands(session: Session, timeout = Time.minute): Promise<string> {
        while (true) {
            const input = await session.prompt(timeout);

            // 如果超时 (input 是 undefined)
            if (!input) {
                await session.send("呜...等了你好久哦...配置向导已自动退出。所有更改都已放弃了哦。下次再来吧！");
                // 设置一个 'quit' 信号，让主循环知道要终止会话
                this.setNavAction("quit");
                return ""; // 返回空字符串，因为主循环会先检查 navAction
            }

            // 如果不是超时，再检查是否是命令
            const cmd = input.toLowerCase();
            if (cmd === "/n" || cmd === "n" || cmd === "/next") {
                this.setNavAction("next");
                return "";
            }
            if (cmd === "/p" || cmd === "p" || cmd === "/prev") {
                this.setNavAction("prev");
                return "";
            }
            if (cmd === "/s" || cmd === "s" || cmd === "/save") {
                this.setNavAction("save");
                return "";
            }
            if (cmd === "/q" || cmd === "q" || cmd === "/quit") {
                this.setNavAction("quit");
                return "";
            }

            // 如果既不是超时也不是命令，就返回用户的原始输入
            return input;
        }
    }

    // --- Handler 工厂函数，减少重复代码 ---

    private createNumberHandler(options: { min?: number; max?: number } = {}): SetupStep["handler"] {
        return async (session, tempConfig) => {
            const step = this.steps[this.currentStep];
            const currentValue = this.getProperty(tempConfig, step.key);

            await session.send(`${step.title}\n${step.description}\n当前值是: \`${currentValue}\`\n请输入新的数值，或者输入 \`/n\` 跳过。`);

            while (true) {
                const input = await this.promptWithCommands(session);
                if (this.navAction) return true; // 导航命令优先

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
            const currentValue = this.getProperty(tempConfig, step.key);

            await session.send(
                `${step.title}\n${step.description}\n当前是: \`${
                    currentValue ? "开启" : "关闭"
                }\`\n请输入 'y' (开启) 或 'n' (关闭)，或者输入 \`/n\` 跳过。`
            );

            while (true) {
                const input = (await this.promptWithCommands(session)).toLowerCase();
                if (this.navAction) return true;

                if (input === "y" || input === "yes" || input === "开启") {
                    this.setProperty(tempConfig, step.key, true);
                    await session.send(`好哒！${step.title} 已设为 \`开启\`！`);
                    return true;
                } else if (input === "n" || input === "no" || input === "关闭") {
                    this.setProperty(tempConfig, step.key, false);
                    await session.send(`了解！${step.title} 已设为 \`关闭\`！`);
                    return true;
                } else {
                    await session.send("诶...听不懂呢，请输入 `y` 或者 `n` 啦！");
                }
            }
        };
    }

    private createStringArrayHandler(): SetupStep["handler"] {
        return async (session, tempConfig) => {
            const step = this.steps[this.currentStep];
            const currentValues = this.getProperty(tempConfig, step.key, []);

            await session.send(`${step.title}\n${step.description}`);
            if (currentValues.length > 0) {
                await session.send(
                    `当前已有的关键词是: \n- ${currentValues.join("\n- ")}\n你可以继续添加，或者输入 \`clear\` 清空后重新添加。`
                );
            }

            let newValues = [...currentValues];
            while (true) {
                const input = await this.promptWithCommands(session);
                if (this.navAction) {
                    // 保存一下用户已经添加的内容
                    this.setProperty(tempConfig, step.key, newValues);
                    return true;
                }

                if (input.toLowerCase() === "done" || input.toLowerCase() === "完成") {
                    break;
                }
                if (input.toLowerCase() === "clear") {
                    newValues = [];
                    await session.send("好哦，已经清空啦，现在可以添加新的了。");
                    continue;
                }

                newValues.push(input);
                await session.send(`已添加关键词: \`${input}\`！继续添加，或者输入 \`done\` 完成。`);
            }

            this.setProperty(tempConfig, step.key, newValues);
            await session.send(`关键词配置完成！最终列表是: \`${newValues.join(", ")}\``);
            return true;
        };
    }
}
