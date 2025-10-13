import { Bot, Context, h, Schema, Session, sleep } from "koishi";

import { AssetService } from "@/services/assets";
import { ToolRuntime } from "@/services/extension";
import { Action, Extension, Tool, withInnerThoughts } from "@/services/extension/decorators";
import { Failed, Success } from "@/services/extension/helpers";
import { ChatModelSwitcher, IChatModel, ModelDescriptor } from "@/services/model";
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
        modelOrGroup: ModelDescriptor | string;
        detail: "low" | "high" | "auto";
    };
}

const CoreUtilConfig: Schema<CoreUtilConfig> = Schema.object({
    typing: Schema.object({
        baseDelay: Schema.number().default(500).description("基础延迟 (毫秒)"),
        charPerSecond: Schema.number().default(5).description("每秒字符数"),
        minDelay: Schema.number().default(800).description("最小延迟 (毫秒)"),
        maxDelay: Schema.number().default(4000).description("最大延迟 (毫秒)"),
    }),
    vision: Schema.object({
        modelOrGroup: Schema.dynamic("modelService.chatModelOrGroup").description("用于图片描述的多模态模型或模型组"),
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
    static readonly inject = [Services.Asset, Services.Model];
    static readonly Config = CoreUtilConfig;

    private readonly assetService: AssetService;
    private disposed: boolean;

    private chatModel: IChatModel | null = null;
    private modelGroup: ChatModelSwitcher | null = null;

    constructor(
        public ctx: Context,
        public config: CoreUtilConfig
    ) {
        this.assetService = ctx[Services.Asset];

        try {
            const visionModel = this.config.vision.modelOrGroup;
            if (visionModel) {
                if (typeof visionModel === "string") {
                    this.modelGroup = this.ctx[Services.Model].useChatGroup(visionModel);
                    if (!this.modelGroup) {
                        this.ctx.logger.warn(``);
                    }
                    const visionModels = this.modelGroup.getModels().filter((m) => m.isVisionModel()) || [];
                    if (visionModels.length === 0) {
                        this.ctx.logger.warn(``);
                    }
                } else {
                    this.chatModel = this.ctx[Services.Model].getChatModel(visionModel);
                    if (!this.chatModel) {
                        this.ctx.logger.warn(`✖ 模型未找到 | 模型: ${JSON.stringify(this.chatModel.id)}`);
                    }
                    if (!this.chatModel.isVisionModel()) {
                        this.ctx.logger.warn(`✖ 模型不支持多模态 | 模型: ${JSON.stringify(this.chatModel.id)}`);
                    }
                }
            }
        } catch (error: any) {
            this.ctx.logger.error(`获取视觉模型失败: ${error.message}`);
        }

        ctx.on("dispose", () => {
            this.disposed = true;
        });
    }

    @Action({
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
            target: Schema.string().description(`Optional. Specifies where to send the message, using \`platform:id\` format.
      Defaults to the current channel. E.g., \`onebot:123456789\` (group), \`discord:private:987654321\` (private chat)`),
        }),
    })
    async sendMessage(params: { message: string; target?: string }, invocation: ToolRuntime) {
        const { message, target } = params;

        const currentPlatform = invocation.platform;
        const currentChannelId = invocation.channelId;
        let bot = invocation.bot;

        if (!bot && currentPlatform) {
            bot = this.ctx.bots.find((b) => b.platform === currentPlatform && (!invocation.bot || b.selfId === invocation.bot.selfId));
        }

        if (!currentPlatform || !currentChannelId || !bot) {
            this.ctx.logger.warn(
                `✖ 发送消息失败 | 缺少上下文信息 platform=${currentPlatform ?? "unknown"}, channel=${currentChannelId ?? "unknown"}, bot=${bot?.selfId ?? "unknown"}`
            );
            return Failed("缺少平台或频道信息，无法发送消息");
        }

        const messages = message.split("<sep/>").filter((msg) => msg.trim() !== "");
        if (messages.length === 0) {
            this.ctx.logger.warn("💬 待发送内容为空 | 原因: 消息分割后无有效内容");
            return Failed("消息内容为空");
        }

        try {
            const { bot: targetBot, targetChannelId } = this.determineTarget(invocation, target);
            const resolvedBot = targetBot ?? bot;

            if (!resolvedBot) {
                const availablePlatforms = this.ctx.bots.map((b) => b.platform).join(", ");
                this.ctx.logger.warn(`✖ 未找到机器人实例 | 目标平台: ${target}, 可用平台: ${availablePlatforms}`);
                return Failed(`未找到平台 ${target} 对应的机器人实例`);
            }

            if (!targetChannelId) {
                this.ctx.logger.warn("✖ 未找到目标频道，无法发送消息");
                return Failed("目标频道缺失，无法发送消息");
            }

            await this.sendMessagesWithHumanLikeDelay(messages, resolvedBot, targetChannelId);

            return Success();
        } catch (error: any) {
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
    async getImageDescription(params: { image_id: string; question: string }, _invocation: ToolRuntime) {
        const { image_id, question } = params;

        const imageInfo = await this.assetService.getInfo(image_id);
        if (!imageInfo) {
            this.ctx.logger.warn(`✖ 图片未找到 | ID: ${image_id}`);
            return Failed(`图片未找到`);
        }
        if (!imageInfo.mime.startsWith("image/")) {
            this.ctx.logger.warn(`✖ 资源不是图片 | ID: ${image_id}`);
            return Failed(`资源不是图片`);
        }

        const image = (await this.assetService.read(image_id, { format: "data-url", image: { process: true, format: "jpeg" } })) as string;

        let prompt;

        if (imageInfo.mime === "image/gif") {
            prompt = `这是一张GIF动图的关键帧序列，你需要结合整体，将其作为一个连续的片段来描述，并回答问题：${question}\n\n图片内容：`;
        } else {
            prompt = `请详细描述以下图片，并回答问题：${question}\n\n图片内容：`;
        }

        try {
            const response = await this.chatModel.chat({
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
        } catch (error: any) {
            this.ctx.logger.error(`图片描述失败: ${error.message}`);
            return Failed(`图片描述失败: ${error.message}`);
        }
    }

    private getTypingDelay(text: string): number {
        const BASE_DELAY = this.config.typing.baseDelay;
        const CHINESE_CHAR_PER_SECOND = this.config.typing.charPerSecond;
        const CHINESE_RANDOM_FACTOR = 0.5;
        const ENGLISH_CHAR_PER_SECOND = this.config.typing.charPerSecond * 1.5;
        const ENGLISH_RANDOM_FACTOR = 0.3;
        const MIN_DELAY = this.config.typing.minDelay;
        const MAX_DELAY = this.config.typing.maxDelay;

        text = h
            .parse(text)
            .filter((e) => e.type === "text")
            .join("");
        if (isEmpty(text)) return MIN_DELAY;

        const chineseRegex = /[\u4e00-\u9fa5]/g;
        const chineseMatches = text.match(chineseRegex);
        const chineseCharCount = chineseMatches ? chineseMatches.length : 0;
        const englishCharCount = text.length - chineseCharCount;
        const chineseDelay = (chineseCharCount / CHINESE_CHAR_PER_SECOND) * 1000;
        const englishDelay = (englishCharCount / ENGLISH_CHAR_PER_SECOND) * 1000;
        const totalRandomness = (chineseCharCount * CHINESE_RANDOM_FACTOR + englishCharCount * ENGLISH_RANDOM_FACTOR) / text.length;
        const randomFactor = 1 + (Math.random() - 0.5) * 2 * totalRandomness;
        const calculatedDelay = BASE_DELAY + (chineseDelay + englishDelay) * randomFactor;
        return Math.max(MIN_DELAY, Math.min(calculatedDelay, MAX_DELAY));
    }

    private determineTarget(invocation: ToolRuntime, target?: string): { bot: Bot | undefined; targetChannelId: string } {
        if (!target) {
            return {
                bot: invocation.bot,
                targetChannelId: invocation.channelId ?? "",
            };
        }

        const parts = target.split(":");
        const platform = parts[0];
        const channelId = parts.slice(1).join(":");
        const bot = this.ctx.bots.find((b) => b.platform === platform);
        return { bot, targetChannelId: channelId };
    }

    private async sendMessagesWithHumanLikeDelay(messages: string[], bot: Bot, channelId: string): Promise<void> {
        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i].trim();
            if (!msg) continue;

            const delay = this.getTypingDelay(msg);
            const content = await this.assetService.encode(msg);
            this.ctx.logger.debug(`发送消息 | 延迟: ${Math.round(delay)}ms`);

            if (i >= 1) await sleep(delay);
            if (this.disposed) return;

            const messageIds = await bot.sendMessage(channelId, content);

            if (messageIds && messageIds.length > 0) {
                this.emitAfterSendEvent(bot, channelId, msg, messageIds[0]);
            }

            if (i < messages.length - 1) {
                const paragraphDelay = 1000 + Math.random() * 1500;
                await sleep(paragraphDelay);
            }
        }
    }

    private emitAfterSendEvent(bot: Bot, channelId: string, content: string, messageId: string): void {
        // Creating a session-like object for the event
        const session = bot.session({
            type: "after-send",
            channel: { id: channelId, type: 0 }, // Assuming guild channel for now
            guild: { id: channelId },
            user: bot.user,
            message: {
                id: messageId,
                content: content,
                elements: h.parse(content),
                timestamp: Date.now(),
                user: bot.user,
            },
        });
        this.ctx.emit("after-send", session as Session);
    }
}
