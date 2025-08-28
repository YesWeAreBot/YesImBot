import { Bot, Context, h, Logger, Schema, Session, sleep } from "koishi";

import { AssetService } from "@/services/assets";
import { Extension, Tool, withInnerThoughts } from "@/services/extension/decorators";
import { Failed, Success } from "@/services/extension/helpers";
import { Infer } from "@/services/extension/types";
import { IChatModel, ModelDescriptor } from "@/services/model";
import { Services } from "@/shared/constants";
import { isEmpty } from "@/shared/utils";

interface CoreUtilConfig {
    typing: {
        baseDelay: number;
        charPerSecond: number;
        minDelay: number;
        maxDelay: number;
    };
    vision: {
        model: ModelDescriptor;
        detail: "low" | "high" | "auto";
    };
}

const CoreUtilConfigSchema: Schema<CoreUtilConfig> = Schema.object({
    typing: Schema.object({
        baseDelay: Schema.number().default(500).description("基础延迟 (毫秒)"),
        charPerSecond: Schema.number().default(5).description("每秒字符数"),
        minDelay: Schema.number().default(800).description("最小延迟 (毫秒)"),
        maxDelay: Schema.number().default(4000).description("最大延迟 (毫秒)"),
    }),
    vision: Schema.object({
        model: Schema.dynamic("modelService.selectableModels").description("用于图片描述的多模态模型"),
        detail: Schema.union(["low", "high", "auto"]).default("low").description("图片细节程度"),
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
    static readonly inject = [Services.Logger, Services.Asset, Services.Model];
    static readonly Config = CoreUtilConfigSchema;

    private readonly logger: Logger;
    private readonly assetService: AssetService;
    private disposed: boolean;

    constructor(
        public ctx: Context,
        public config: CoreUtilConfig
    ) {
        this.logger = ctx[Services.Logger].getLogger("[核心工具]");
        this.assetService = ctx[Services.Asset];

        ctx.on("dispose", () => {
            this.disposed = true;
        });
    }

    @Tool({
        name: "send_message",
        description: "发送消息",
        parameters: withInnerThoughts({
            message: Schema.string().required().description(`**Visible message content to the user.**
      You may embed the platform's XML-style formatting tags **only inside this field**, never outside the JSON.
      - \`<at id="USER_ID"/>\` : Mention a user. E.g., \`<at id="12345"/> 在吗？\`
      - \`<quote id="MESSAGE_ID"/>\` : Quote a specific message. Must be the FIRST element in the message. E.g., \`<quote id="abc-def"/>你刚刚说的那个是啥意思\`
      - \`<img id="INTERNAL_ID"/>\` : Send an image with known ID. E.g., \`<img id="pixiv-12345"/>\`
      - \`<sep/>\` : Split a long message into multiple parts (natural delays). E.g., \`这个啊<sep/>我看一下...\`
      Rules:
        * These tags are part of the message formatting capabilities of this platform.
        * You MUST only include them inside the \`message\` field of a \`send_message\` action.
        * NEVER output them at the top-level of your reply or inside "thoughts".
        * Do not wrap them in Markdown.`),
            target: Schema.string().description(
                "Optional. Specifies where to send the message, using `platform:id` format.\n        Defaults to the current channel. E.g., `onebot:123456789` (group), `discord:private:987654321` (private chat)"
            ),
        }),
    })
    async sendMessage(args: Infer<{ message: string; target?: string }>) {
        const { session, message, target } = args;

        if (!session) {
            this.logger.warn("✖ 缺少有效会话，无法发送消息");
            return Failed("缺少会话对象");
        }

        const messages = message.split("<sep/>").filter((msg) => msg.trim() !== "");
        if (messages.length === 0) {
            this.logger.warn("💬 待发送内容为空 | 原因: 消息分割后无有效内容");
            return Failed("消息内容为空");
        }

        try {
            const { bot, channelId, finalTarget } = this.determineTarget(session, target);

            if (!bot) {
                const availablePlatforms = this.ctx.bots.map((b) => b.platform).join(", ");
                this.logger.warn(`✖ 未找到机器人实例 | 目标平台: ${target}, 可用平台: ${availablePlatforms}`);
                return Failed(`未找到平台 ${target} 对应的机器人实例`);
            }

            // this.logger.info(`准备发送消息 | 目标: ${finalTarget} | 分段数: ${messages.length}`);

            await this.sendMessagesWithHumanLikeDelay(messages, bot, channelId, session);

            return Success();
        } catch (error) {
            //this.logger.error(error);
            return Failed(`发送消息失败，可能是已被禁言或网络错误。错误: ${error.message}`);
        }
    }

    @Tool({
        name: "get_image_description",
        description: "使用外部视觉模型获取图片描述，当你无法查看图片，或者此图片数据在上下文中丢失时使用此工具",
        parameters: withInnerThoughts({
            image_id: Schema.string().required().description("要获取的图片ID，如在 `<img id='12345'>` 中的 12345 即是其 ID"),
            question: Schema.string().required().description("要询问的问题，如'图片中有什么?'"),
        }),
    })
    async getImageDescription(args: Infer<{ image_id: string; question: string }>) {
        const { image_id, question } = args;

        const imageInfo = await this.assetService.getInfo(image_id);
        if (!imageInfo) {
            this.logger.warn(`✖ 图片未找到 | ID: ${image_id}`);
            return Failed(`图片未找到`);
        }
        if (!imageInfo.mime.startsWith("image/")) {
            this.logger.warn(`✖ 资源不是图片 | ID: ${image_id}`);
            return Failed(`资源不是图片`);
        }

        const image = (await this.assetService.read(image_id, { format: "data-url", image: { process: true, format: "jpeg" } })) as string;

        const visionModel = this.config.vision.model;
        let model: IChatModel | null = null;

        try {
            model = this.ctx[Services.Model].getChatModel(visionModel.providerName, visionModel.modelId);
            if (!model) {
                this.logger.warn(`✖ 模型未找到 | 模型: ${visionModel.providerName}:${visionModel.modelId}`);
                return Failed(`模型未找到`);
            }
            if (!model.isVisionModel()) {
                this.logger.warn(`✖ 模型不支持多模态 | 模型: ${visionModel.providerName}:${visionModel.modelId}`);
                return Failed(`模型不支持多模态`);
            }
        } catch (error) {
            this.logger.error(`获取视觉模型失败: ${error.message}`);
            return Failed(`获取视觉模型失败: ${error.message}`);
        }

        let prompt;

        if (imageInfo.mime === "image/gif") {
            prompt = `这是一张GIF动图的关键帧序列，你需要结合整体，将其作为一个连续的片段来描述，并回答问题：${question}\n\n图片内容：`;
        } else {
            prompt = `请详细描述以下图片，并回答问题：${question}\n\n图片内容：`;
        }

        try {
            const response = await model.chat({
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: prompt },
                            { type: "image_url", image_url: { url: image, detail: this.config.vision.detail } },
                        ],
                    },
                ],
                temperature: 0.2,
            });
            return Success(response.text);
        } catch (error) {
            this.logger.error(`图片描述失败: ${error.message}`);
            return Failed(`图片描述失败: ${error.message}`);
        }
    }

    private getTypingDelay(text: string): number {
        // --- 可配置参数 ---
        const BASE_DELAY = this.config.typing.baseDelay;

        // 中文输入模拟 (拼音输入法)
        const CHINESE_CHAR_PER_SECOND = this.config.typing.charPerSecond;
        const CHINESE_RANDOM_FACTOR = 0.5;

        // 英文输入模拟
        const ENGLISH_CHAR_PER_SECOND = this.config.typing.charPerSecond * 1.5;
        const ENGLISH_RANDOM_FACTOR = 0.3; // 英文输入的随机性较小

        // 延迟上下限
        const MIN_DELAY = this.config.typing.minDelay;
        const MAX_DELAY = this.config.typing.maxDelay;

        // --- 逻辑实现 ---

        // 1. 统计中英文字符数
        let chineseCharCount = 0;
        let englishCharCount = 0;

        // 只统计纯文本
        text = h
            .parse(text)
            .filter((e) => e.type === "text")
            .join("");

        if (isEmpty(text)) {
            return MIN_DELAY;
        }

        // 使用正则表达式匹配中文字符 (Unicode范围)
        const chineseRegex = /[\u4e00-\u9fa5]/g;
        const chineseMatches = text.match(chineseRegex);
        chineseCharCount = chineseMatches ? chineseMatches.length : 0;

        // 英文及其他字符（数字、符号等）可以大致归为一类
        englishCharCount = text.length - chineseCharCount;

        // 2. 分别计算中英文部分的延迟
        const chineseDelay = (chineseCharCount / CHINESE_CHAR_PER_SECOND) * 1000;
        const englishDelay = (englishCharCount / ENGLISH_CHAR_PER_SECOND) * 1000;

        // 3. 计算总延迟并加入随机性
        // 随机性的大小也与中英文字符数量有关，让节奏更真实
        const totalRandomness = (chineseCharCount * CHINESE_RANDOM_FACTOR + englishCharCount * ENGLISH_RANDOM_FACTOR) / text.length;
        const randomFactor = 1 + (Math.random() - 0.5) * 2 * totalRandomness; // 在 (1-totalRandomness) 到 (1+totalRandomness) 之间

        const calculatedDelay = BASE_DELAY + (chineseDelay + englishDelay) * randomFactor;

        // 4. 应用延迟上下限
        return Math.max(MIN_DELAY, Math.min(calculatedDelay, MAX_DELAY));
    }

    /**
     * 决定消息的最终目标和使用的机器人实例
     */
    private determineTarget(koishiSession: Session, target?: string): { bot: Bot | undefined; channelId: string; finalTarget: string } {
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
    private async sendMessagesWithHumanLikeDelay(messages: string[], bot: Bot, channelId: string, originalSession: Session): Promise<void> {
        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i].trim();
            if (!msg) continue;

            // --- 人性化延迟的核心部分 ---
            const delay = this.getTypingDelay(msg);

            // --- 处理图片元素 ---
            const content = await this.assetService.encode(msg);

            this.logger.debug(`发送消息 | 延迟: ${Math.round(delay)}ms`);

            await sleep(delay);

            if (this.disposed) return;

            // --- 发送消息 ---
            const messageIds = await bot.sendMessage(channelId, content);

            // --- 发送后处理 ---
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
    private emitAfterSendEvent(bot: Bot, channelId: string, content: string, messageId: string, originalSession: Session): void {
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
