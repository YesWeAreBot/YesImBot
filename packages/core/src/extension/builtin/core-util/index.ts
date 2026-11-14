import { Bot, Context, h, Logger, Schema, Session, sleep, Universal } from "koishi";

import { assertReplyDestination, assertReplyTurn, guardReplyBot, replyTurnSignal, sendMessageWithReceipts } from "../../../agent/reply-turn";
import { AssetService } from "../../../asset";
import { Extension, Tool, withInnerThoughts } from "../../../extension/decorators";
import { Failed, Success } from "../../../extension/helpers";
import { Infer } from "../../../extension/types";
import { formatLogTarget } from "../../../logger/conversation";
import { IChatModel } from "../../../model";
import { withUsageScope } from "../../../model/usage";
import { MessageDeliveryError, type ConfirmedMessage } from "../../../shared/message-delivery";
import { isEmpty, parseConversationChannelId } from "../../../shared/utils";
import { CoreUtilConfigSchema, type CoreUtilConfig } from "./config";

function sendErrorScalar(key: string, value: unknown): string {
    return (typeof value === "string" || typeof value === "number") && String(value).trim() ? `${key}=${String(value).slice(0, 512)}` : "";
}

@Extension({
    name: "core_util",
    display: "核心工具集",
    description: "必要工具",
    version: "1.0.0",
    builtin: true,
})
export default class CoreUtilExtension {
    static readonly inject = ["yesimbot"];
    static readonly Config = CoreUtilConfigSchema;

    private readonly logger: Logger;
    private readonly assetService: AssetService;
    private disposed: boolean = false;

    constructor(
        public ctx: Context,
        public config: CoreUtilConfig,
    ) {
        this.logger = ctx.yesimbot.logging.getLogger("[核心工具]");
        this.assetService = ctx.yesimbot.asset;

        ctx.on("dispose", () => {
            this.disposed = true;
        });
    }

    @Tool({
        name: "send_message",
        timeout(this: CoreUtilExtension, params) {
            if (this.config.deliveryTimeoutMs && this.config.deliveryTimeoutMs > 0) return this.config.deliveryTimeoutMs;
            const parts = typeof params.message === "string" ? params.message.split("<sep/>").filter((part) => part.trim()).length : 1;
            const typing = Math.max(this.config.typing.maxDelay, this.config.typing.minDelay, 0);
            return Math.max(30000, parts * (typing + 30000) + Math.max(0, parts - 1) * 2500);
        },
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
      Defaults to the current channel. Use the adapter's exact channel ID, e.g. \`onebot:123456789\`.
      For a private recipient user ID, set target_type to private; the adapter resolves its channel ID.`),
            guild_id: Schema.string().description("目标群组或服务器 ID。发送到 Telegram 话题时填写所属群 ID"),
            self_id: Schema.string().description("发送所用的机器人账号 ID。同平台默认使用当前账号；其他平台有多个账号时必须指定"),
            target_type: Schema.union([Schema.const("channel"), Schema.const("private")]).description(
                "目标为原生频道 ID（channel）或私聊用户 ID（private）；默认 channel",
            ),
        }),
    })
    async sendMessage(args: Infer<{ message: string; target?: string; self_id?: string; target_type?: "channel" | "private"; guild_id?: string }>) {
        const { session, message, target, self_id, target_type, guild_id } = args;

        if (!session) {
            this.logger.warn("✖ 缺少有效会话，无法发送消息");
            return Failed("缺少会话对象");
        }

        if (typeof message !== "string") return Failed("message 必须是字符串");
        const messages = message.split("<sep/>").filter((msg) => msg.trim() !== "");
        if (messages.length === 0) {
            this.logger.debug("空消息 · 本轮保持沉默");
            return Success(undefined, { intentionalSilence: true });
        }

        const delivery = { messageIds: [] as string[], sentMessages: 0, totalMessages: messages.length, inFlight: false, deliveryUnknown: false };
        const publish = () => args.toolContext?.reportMetadata?.({ delivery });
        publish();
        let destination: string | undefined;
        try {
            const { bot, channelId, channel, userId, guild } = await this.determineTarget(session, target, self_id, target_type, guild_id);

            destination = formatLogTarget({
                platform: bot.platform,
                selfId: bot.selfId,
                channelId,
                guildId: guild?.id ?? (bot === session.bot && channelId === session.channelId ? session.guildId : undefined),
                isDirect: channel?.type === Universal.Channel.Type.DIRECT || (bot === session.bot && channelId === session.channelId && session.isDirect),
            });
            await this.sendMessagesWithHumanLikeDelay(messages, bot, channelId, session, channel, userId, guild, delivery, publish);

            publish();
            this.logger.info(`发送目标 ${destination} · 适配器已确认 ${delivery.messageIds.length} 条消息`);
            return Success(undefined, { delivery });
        } catch (error) {
            const partial = delivery.messageIds.length > 0;
            publish();
            this.logger.warn(
                `发送目标 ${destination ?? "未解析"} · ${partial ? `已确认 ${delivery.messageIds.length} 条消息，未完成全部发送` : delivery.deliveryUnknown ? "发送结果未知" : "发送失败"}`,
            );
            return Failed(
                {
                    name: partial ? "PartialDeliveryError" : "ToolError",
                    message: `${partial ? `消息未全部发送：已完整发送 ${delivery.sentMessages}/${delivery.totalMessages} 段（确认 ${delivery.messageIds.length} 条消息），请勿重复发送已送达内容` : delivery.deliveryUnknown ? "消息已提交但送达结果未知，请勿自动重发" : "发送消息失败"}。错误: ${this.getSendErrorMessage(error) || "未知发送错误"}`,
                    retryable: false,
                },
                { delivery },
            );
        }
    }

    @Tool({
        name: "get_image_description",
        readOnly: true,
        isAvailable(this: CoreUtilExtension, context) {
            const selected = this.config.vision?.model;
            if (!selected?.providerName || !selected.modelId) return "辅助识图尚未配置可用的视觉模型，请依据已有信息回答并说明无法辨认的部分";
            if (context?.attachedImageIds?.length && !this.config.vision.allowAuxiliary)
                return "图片已随本轮主请求提供，请直接依据图片回答；辅助识图仅按管理员策略可用，不要重复请求同图识别";
            try {
                const model = this.ctx.yesimbot.model?.getChatModel?.(selected.providerName, selected.modelId);
                return !!model?.isVisionModel();
            } catch {
                return false;
            }
        },
        timeout(this: CoreUtilExtension) {
            if (this.config.vision.timeoutMs && this.config.vision.timeoutMs > 0) return this.config.vision.timeoutMs;
            const selected = this.config.vision.model;
            const model = selected && this.ctx.yesimbot.model.getChatModel?.(selected.providerName, selected.modelId);
            const seconds = model?.config?.timeoutPolicy?.totalTimeout ?? 90;
            const retries = model?.config?.retryPolicy?.maxRetries ?? 0;
            return Math.max(120000, seconds * 1000 * (retries + 1) + retries * 300000 + 30000);
        },
        background: true,
        description: "使用外部视觉模型获取图片描述，当你无法查看图片，或者此图片数据在上下文中丢失时使用此工具",
        parameters: withInnerThoughts({
            image_id: Schema.string().required().description("要获取的图片ID，如在 `<img id='12345'>` 中的 12345 即是其 ID"),
            question: Schema.string().required().description("要询问的问题，如'图片中有什么?'"),
        }),
    })
    async getImageDescription(args: Infer<{ image_id: string; question: string }>) {
        const { image_id, question, session } = args;
        if (!this.config.vision.allowAuxiliary && args.toolContext?.attachedImageIds?.includes(image_id)) {
            return Success({
                status: "already_visible",
                message: "本图像素已直接提供给当前聊天模型，请直接查看并回答；不要重复请求辅助识图。如无法辨认，请明确说明不确定。",
            });
        }

        args.toolContext?.reportProgress?.("正在读取图片资源");
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
            model = this.ctx.yesimbot.model.useChatModel(visionModel.providerName, visionModel.modelId);
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
            args.toolContext?.reportProgress?.("正在请求视觉模型");
            const response = await withUsageScope(
                { platform: session?.platform, botId: session?.selfId, target: session?.channelId, purpose: "图片描述" },
                () => {
                    assertReplyTurn();
                    return model.chat({
                        abortSignal: replyTurnSignal(),
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
                },
            );
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
    private async determineTarget(
        session: Session,
        target?: string,
        selfId?: string,
        targetType: "channel" | "private" = "channel",
        guildId?: string,
    ): Promise<{ bot: Bot; channelId: string; channel?: Universal.Channel; userId?: string; guild?: Universal.Guild }> {
        let platform = session.platform;
        let channelId = session.channelId!;
        if (target !== undefined) {
            const separator = target.indexOf(":");
            if (separator <= 0 || separator === target.length - 1) throw new Error("目标格式必须为 platform:id，平台和 ID 均不能为空");
            platform = target.slice(0, separator);
            channelId = target.slice(separator + 1);
        } else if (targetType === "private") {
            throw new Error("私聊用户目标需要提供 target");
        }
        if (!platform || !channelId) throw new Error("目标平台或频道为空");
        const native = parseConversationChannelId(platform, channelId);
        if (native.guildId) {
            if (guildId && guildId !== native.guildId) throw new Error("目标群组与话题标识不一致");
            guildId = native.guildId;
            channelId = native.channelId;
        }

        let bot: Bot;
        if (platform === session.platform && (selfId === undefined || selfId === session.selfId)) {
            bot = session.bot;
        } else {
            const candidates = this.ctx.bots.filter((candidate) => candidate.platform === platform && (selfId === undefined || candidate.selfId === selfId));
            if (candidates.length !== 1) {
                throw new Error(candidates.length ? "目标平台存在多个机器人账号，请指定 self_id" : "未找到目标平台和 self_id 对应的机器人账号");
            }
            bot = guardReplyBot(candidates[0]);
        }

        // Explicit QQ private prefixes are resolved through each adapter's native channel mapping.
        const currentTarget = bot === session.bot && channelId === session.channelId && (!guildId || guildId === session.guildId);
        const privateTarget = targetType === "private" || (!currentTarget && platform === "qq" && channelId.startsWith("private:"));
        if (privateTarget) {
            const userId = platform === "qq" && channelId.startsWith("private:") ? channelId.slice(8) : channelId;
            if (!userId) throw new Error("私聊用户 ID 不能为空");
            const sourceGuildId = guildId ?? (platform === session.platform && bot.selfId === session.selfId ? session.guildId : undefined);
            const channel = await bot.createDirectChannel(userId, sourceGuildId);
            if (!channel?.id) throw new Error("适配器未返回私聊频道 ID");
            return { bot, channelId: channel.id, channel: { ...channel, type: Universal.Channel.Type.DIRECT }, userId };
        }
        if (platform === "telegram" && !currentTarget && /^\d+$/.test(channelId) && !guildId)
            throw new Error("Telegram 话题目标需要 guild_id；私聊用户目标请使用 target_type: private");
        return {
            bot,
            channelId,
            ...(guildId ? { channel: { id: channelId, type: Universal.Channel.Type.TEXT }, guild: { id: guildId } } : {}),
        };
    }

    private getSendErrorMessage(error: unknown, seen = new Set<unknown>()): string {
        if (typeof error === "string") return error;
        if (!error || typeof error !== "object" || seen.has(error)) return "";
        seen.add(error);
        const details = error as { message?: string; errors?: unknown[]; cause?: unknown; code?: unknown; response?: { status?: unknown; data?: unknown } };
        // Only expose diagnostic fields, never serialize request config or headers.
        const data = details.response?.data;
        const api = data && typeof data === "object" ? (data as Record<string, unknown>) : undefined;
        const messages = [
            ...(Array.isArray(details.errors) ? details.errors.map((inner) => this.getSendErrorMessage(inner, seen)) : []),
            this.getSendErrorMessage(details.cause, seen),
            typeof details.message === "string" ? details.message : "",
            sendErrorScalar("code", details.code),
            sendErrorScalar("HTTP", details.response?.status),
            ...["code", "message", "msg", "trace_id"].map((key) => sendErrorScalar(key, api?.[key])),
        ].filter(Boolean);
        return [...new Set(messages)].join("; ");
    }

    /**
     * 带有“人性化”延迟的消息发送执行器
     * @param messages 要发送的消息数组
     * @param bot 用于发送的机器人实例
     * @param channelId 目标频道ID
     * @param originalSession 原始会话，用于被动回复及创建after-send事件
     */
    private async sendMessagesWithHumanLikeDelay(
        messages: string[],
        bot: Bot,
        channelId: string,
        originalSession: Session,
        channel?: Universal.Channel,
        userId?: string,
        guild?: Universal.Guild,
        delivery = { messageIds: [] as string[], sentMessages: 0, totalMessages: messages.length, inFlight: false, deliveryUnknown: false },
        publish: () => void = () => {},
    ): Promise<void> {
        const sameSession =
            bot === originalSession.bot &&
            channelId === originalSession.channelId &&
            (!guild || guild.id === originalSession.guildId) &&
            (channel?.type === undefined || (channel.type === Universal.Channel.Type.DIRECT) === !!originalSession.isDirect);
        let routingSession: ReturnType<Bot["session"]> | undefined;
        if (!sameSession && (channel || guild || bot.platform === "qq")) {
            const direct = channel?.type === Universal.Channel.Type.DIRECT;
            routingSession = bot.session({
                type: "send",
                channel: channel ?? { id: channelId, type: Universal.Channel.Type.TEXT },
                guild: direct ? undefined : (guild ?? (bot.platform === "qq" ? { id: channelId } : undefined)),
                user: userId ? { id: userId } : undefined,
                message: userId ? { user: { id: userId } } : undefined,
            });
            // Older QQ encoders dereference this payload even for active messages.
            if (bot.platform === "qq") (routingSession as any).qq = {};
        }
        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i].trim();
            if (!msg) continue;

            // --- 人性化延迟的核心部分 ---
            const delay = this.getTypingDelay(msg);

            // --- 处理图片元素 ---
            const quoted =
                sameSession && bot.platform === "slack" && originalSession.quote?.id && !h.select(h.parse(msg), "quote").length
                    ? h("quote", { id: originalSession.quote.id }).toString() + msg
                    : msg;
            const content = await this.assetService.encode(quoted);

            this.logger.debug(`发送第 ${i + 1}/${messages.length} 段 · 等待 ${Math.round(delay)}ms`);

            await sleep(delay);

            if (this.disposed) throw new Error("核心工具已卸载，消息未发送");
            assertReplyDestination({
                platform: bot.platform!,
                selfId: bot.selfId,
                channelId,
                guildId: guild?.id ?? (sameSession ? originalSession.guildId : undefined),
                isDirect: channel?.type === Universal.Channel.Type.DIRECT || (sameSession && originalSession.isDirect),
            });

            // --- 发送消息 ---
            let messageIds: string[];
            let receipts: ConfirmedMessage[] | undefined;
            let partialError: MessageDeliveryError | undefined;
            try {
                delivery.inFlight = true;
                delivery.deliveryUnknown = true;
                publish();
                const sent = await sendMessageWithReceipts(
                    bot,
                    channelId,
                    content,
                    sameSession ? originalSession.event.referrer : undefined,
                    sameSession ? { session: originalSession } : routingSession ? { session: routingSession } : undefined,
                    (confirmed) => {
                        for (const receipt of confirmed) if (!delivery.messageIds.includes(receipt.id)) delivery.messageIds.push(receipt.id);
                        publish();
                    },
                );
                messageIds = sent.ids;
                receipts = sent.messages;
                delivery.inFlight = false;
            } catch (error) {
                if (!(error instanceof MessageDeliveryError)) throw error;
                partialError = error;
                messageIds = error.messages.map((message) => message.id);
            }
            const confirmedIds = [...new Set((Array.isArray(messageIds) ? messageIds : []).filter((id) => typeof id === "string" && id.trim()))];
            if (!confirmedIds.length) {
                if (partialError) throw partialError;
                throw new Error("适配器未返回消息 ID，无法确认发送结果");
            }
            for (const id of confirmedIds) if (!delivery.messageIds.includes(id)) delivery.messageIds.push(id);
            if (!partialError) {
                delivery.sentMessages++;
                delivery.deliveryUnknown = false;
            }
            delivery.inFlight = false;
            publish();

            // Preserve confirmed external effects even if a later encoder request failed.
            for (const messageId of confirmedIds) {
                const confirmed = partialError?.messages ?? receipts;
                // A fully successful single-ID send maps to this one submitted paragraph.
                // Split/partial results require per-ID content from the adapter itself.
                const sentContent =
                    confirmed?.find((message) => message.id === messageId)?.content ||
                    (!partialError && confirmedIds.length === 1 ? h.normalize(content).join("") : "");
                await this.emitAfterSendEvent(bot, channelId, sentContent, messageId, originalSession, channel, guild);
            }
            if (partialError) throw partialError;

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
    private async emitAfterSendEvent(
        bot: Bot,
        channelId: string,
        content: string,
        messageId: string,
        originalSession: Session,
        resolvedChannel?: Universal.Channel,
        resolvedGuild?: Universal.Guild,
    ): Promise<void> {
        const sameSession =
            bot === originalSession.bot && channelId === originalSession.channelId && (!resolvedGuild || resolvedGuild.id === originalSession.guildId);
        let channel = resolvedChannel ?? (sameSession ? originalSession.event.channel : undefined);
        if (!channel) {
            try {
                channel = await bot.getChannel(channelId);
            } catch (error) {
                this.logger.debug(`获取目标频道信息失败: ${this.getSendErrorMessage(error)}`);
            }
        }
        channel = {
            ...channel,
            id: channelId,
            type:
                channel?.type ??
                ((sameSession ? originalSession.isDirect : bot.platform === "onebot" && channelId.startsWith("private:"))
                    ? Universal.Channel.Type.DIRECT
                    : Universal.Channel.Type.TEXT),
        };
        const guild =
            channel.type === Universal.Channel.Type.DIRECT
                ? undefined
                : resolvedGuild
                  ? resolvedGuild
                  : sameSession
                    ? originalSession.event.guild
                    : bot.platform === "onebot"
                      ? { id: channelId }
                      : undefined;
        const timestamp = Date.now();
        const session = bot.session({
            type: "after-send",
            platform: bot.platform,
            selfId: bot.selfId,
            timestamp,
            user: bot.user,
            message: {
                id: messageId,
                content,
                elements: h.parse(content),
                timestamp,
                user: bot.user,
            },
            channel,
            guild,
        });
        session.content = content;
        this.ctx.emit(session, "after-send", session as Session);
    }
}
