import { Bot, Context, h, Logger, Schema, Session, sleep } from "koishi";

import { Extension, Tool, withInnerThoughts } from "@/services/extension/decorators";
import { Failed, Success } from "@/services/extension/helpers";
import { Infer } from "@/services/extension/types";
import { Services } from "@/services/types";

interface CoreUtilConfig {
    typing: {
        baseDelay: number;
        charPerSecond: number;
        minDelay: number;
        maxDelay: number;
    };
}

const CoreUtilConfigSchema: Schema<CoreUtilConfig> = Schema.object({
    typing: Schema.object({
        baseDelay: Schema.number().default(500).description("基础延迟 (毫秒)"),
        charPerSecond: Schema.number().default(5).description("每秒字符数"),
        minDelay: Schema.number().default(800).description("最小延迟 (毫秒)"),
        maxDelay: Schema.number().default(4000).description("最大延迟 (毫秒)"),
    }),
});

@Extension({
    name: "core_util",
    display: "核心工具集",
    description: "必要工具",
    version: "1.0.0",
    builtin: true,
})
export default class CoreUtilExtension {
    static readonly Config = CoreUtilConfigSchema;

    private readonly logger: Logger;

    constructor(public ctx: Context, public config: CoreUtilConfig) {
        this.logger = ctx[Services.Logger].getLogger("[核心工具]");
    }

    @Tool({
        name: "send_message",
        description: "发送消息",
        parameters: withInnerThoughts({
            message: Schema.string().description(
                "The message content to send. Use `<sep/>` to split a long response into multiple, shorter messages, which will be sent with natural delays. E.g., 'Hello there<sep/>How are you?'"
            ),
            target: Schema.string().description(
                "Optional. Specifies where to send the message, using `platform:id` format. Defaults to the current channel. E.g., `onebot:123456789` for a group, or `discord:private:987654321` for a private chat."
            ),
        }),
    })
    async sendMessage(args: Infer<{ message: string; target?: string }>) {
        const { session, message, target } = args;

        if (!session) {
            this.logger.warn("✖ 缺少有效会话，无法发送消息。");
            return Failed("缺少会话对象");
        }

        const messages = message.split("<sep/>").filter((msg) => msg.trim() !== "");
        if (messages.length === 0) {
            this.logger.warn("💬 待发送内容为空 | 原因: 消息分割后无有效内容。");
            return Failed("消息内容为空");
        }

        try {
            const { bot, channelId, finalTarget } = this.determineTarget(session, target);

            if (!bot) {
                const availablePlatforms = this.ctx.bots.map((b) => b.platform).join(", ");
                this.logger.warn(`✖ 未找到机器人实例 | 目标平台: ${target}, 可用平台: ${availablePlatforms}`);
                return Failed(`未找到平台 ${target} 对应的机器人实例。`);
            }

            this.logger.info(`🚀 准备发送消息 | 目标: ${finalTarget} | 分段数: ${messages.length}`);

            await this.sendMessagesWithHumanLikeDelay(messages, bot, channelId, session);

            return Success(`✅ 消息已成功发送至 ${finalTarget}`);
        } catch (error) {
            return Failed(`发送消息失败: ${error.message}`);
        }
    }

    private getTypingDelay(text: string): number {
        // --- 可配置参数 ---
        const BASE_DELAY = this.config.typing.baseDelay;

        // 中文输入模拟 (拼音输入法)
        const DELAY_PER_CHINESE_CHAR = this.config.typing.charPerSecond;
        const CHINESE_RANDOM_FACTOR = 0.5;

        // 英文输入模拟
        const DELAY_PER_ENGLISH_CHAR = this.config.typing.charPerSecond * 1.5;
        const ENGLISH_RANDOM_FACTOR = 0.3; // 英文输入的随机性较小

        // 延迟上下限
        const MIN_DELAY = this.config.typing.minDelay;
        const MAX_DELAY = this.config.typing.maxDelay;

        // --- 逻辑实现 ---

        // 1. 统计中英文字符数
        let chineseCharCount = 0;
        let englishCharCount = 0;

        // 使用正则表达式匹配中文字符 (Unicode范围)
        const chineseRegex = /[\u4e00-\u9fa5]/g;
        const chineseMatches = text.match(chineseRegex);
        chineseCharCount = chineseMatches ? chineseMatches.length : 0;

        // 英文及其他字符（数字、符号等）可以大致归为一类
        englishCharCount = text.length - chineseCharCount;

        // 2. 分别计算中英文部分的延迟
        const chineseDelay = chineseCharCount * DELAY_PER_CHINESE_CHAR;
        const englishDelay = englishCharCount * DELAY_PER_ENGLISH_CHAR;

        // 3. 计算总延迟并加入随机性
        // 随机性的大小也与中英文字符数量有关，让节奏更真实
        const totalRandomness =
            (chineseCharCount * CHINESE_RANDOM_FACTOR + englishCharCount * ENGLISH_RANDOM_FACTOR) / text.length;
        const randomFactor = 1 + (Math.random() - 0.5) * 2 * totalRandomness; // 在 (1-totalRandomness) 到 (1+totalRandomness) 之间

        const calculatedDelay = BASE_DELAY + (chineseDelay + englishDelay) * randomFactor;

        // 4. 应用延迟上下限
        return Math.max(MIN_DELAY, Math.min(calculatedDelay, MAX_DELAY));
    }

    /**
     * 决定消息的最终目标和使用的机器人实例
     */
    private determineTarget(
        koishiSession: Session,
        target?: string
    ): { bot: Bot | undefined; channelId: string; finalTarget: string } {
        if (!target || target === `${koishiSession.platform}:${koishiSession.channelId}`) {
            // 发送至当前会话
            return {
                bot: koishiSession.bot,
                channelId: koishiSession.channelId,
                finalTarget: `${koishiSession.platform}:${koishiSession.channelId}`,
            };
        } else {
            // 发送至指定目标
            const parts = target.split(":");
            const platform = parts[0];
            const channelId = parts.slice(1).join(":");
            const bot = this.ctx.bots.find((b) => b.platform === platform);
            return { bot, channelId, finalTarget: target };
        }
    }

    /**
     * 带有“人性化”延迟的消息发送执行器
     * @param messages 要发送的消息数组
     * @param bot 用于发送的机器人实例
     * @param channelId 目标频道ID
     * @param originalSession 原始会话，用于创建after-send事件
     */
    private async sendMessagesWithHumanLikeDelay(
        messages: string[],
        bot: Bot,
        channelId: string,
        originalSession: Session
    ): Promise<void> {
        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i].trim();
            if (!msg) continue;

            // --- 人性化延迟的核心部分 ---
            const delay = this.getTypingDelay(msg);

            await sleep(delay);

            // --- 发送消息 ---
            const messageIds = await bot.sendMessage(channelId, msg);

            // --- 发送后处理（例如发射事件）---
            // 使用 then 回调不是最佳实践，async/await 更清晰
            if (messageIds && messageIds.length > 0) {
                this.emitAfterSendEvent(bot, channelId, msg, messageIds[0], originalSession);
            }

            // 如果还有下一条消息，增加一个“段落间隔”延迟
            if (i < messages.length - 1) {
                const paragraphDelay = 1000 + Math.random() * 1500; // 1秒到2.5秒的随机停顿

                await sleep(paragraphDelay);
            }
        }
    }

    /**
     * 封装 after-send 事件的发射逻辑
     */
    private emitAfterSendEvent(
        bot: Bot,
        channelId: string,
        content: string,
        messageId: string,
        originalSession: Session
    ): void {
        const session = bot.session({
            ...originalSession.event,
            type: "after-send",
            message: {
                id: messageId,
                content: content,
                elements: h.parse(content),
                timestamp: Date.now(),
                user: bot.user,
            },
            channel: {
                id: channelId,
                type: originalSession.guildId ? 0 : 1,
            },
        });
        this.ctx.emit("after-send", session as Session);
    }
}
