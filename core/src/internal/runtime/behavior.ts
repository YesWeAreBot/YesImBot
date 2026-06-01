import { Context, Logger, Schema } from "koishi";

import type { PlatformEvent } from "../../shared/platform-event.js";

export interface WillingnessConfig {
  /** 收到普通文本消息的基础分。这是对话的基石 */
  text: number;

  /** 被 @ 提及时的额外加成。这是最高优先级的信号 */
  atMention: number;
  /** 作为"回复/引用"出现时的额外加成。表示对话正在延续 */
  isQuote: number;
  /** 在私聊场景下的额外加成。私聊通常期望更高的响应度 */
  isDirectMessage: number;

  /** 触发"高兴趣"的关键词列表 */
  keywords: string[];
  /** 消息包含关键词时，应用此乘数。>1 表示增强，<1 表示削弱 */
  keywordMultiplier: number;
  /** 默认乘数（当没有关键词匹配时）。设为1表示不影响 */
  defaultMultiplier: number;

  /** 意愿值的最大上限 */
  maxWillingness: number;
  /** 意愿值衰减到一半所需的时间（秒）。这是一个基础值，会受对话热度影响 */
  decayHalfLifeSeconds: number;
  /** 将意愿值转换为回复概率的"激活门槛" */
  probabilityThreshold: number;
  /** 超过门槛后，转换为概率时的放大系数 */
  probabilityAmplifier: number;
  /** 决定回复后，扣除的"发言精力惩罚"基础值 */
  replyCost: number;

  //   readonly system?: SystemConfig;
}

export const WillingnessConfigSchema: Schema<WillingnessConfig> = Schema.object({
  text: Schema.number()
    .default(12)
    .default(12)
    .description(
      "收到普通文本消息的基础分<br/>这部分参数都可以通过 `添加分支` 进行更加精细化的配置",
    ),

  atMention: Schema.number().default(100).default(100).description("被@时的额外加成"),
  isQuote: Schema.number().default(15).default(15).description("作为回复/引用时的额外加成"),
  isDirectMessage: Schema.number().default(40).default(40).description("在私聊场景下的额外加成"),

  keywords: Schema.array(Schema.string())
    .default([])
    .role("table")
    .default([])
    .description("触发高兴趣的关键词"),
  keywordMultiplier: Schema.number().default(1.2).default(1.2).description("包含关键词时的乘数"),
  defaultMultiplier: Schema.number().default(1).default(1).description("默认乘数"),

  maxWillingness: Schema.number().default(100).min(10).default(100).description("意愿值的最大上限"),
  decayHalfLifeSeconds: Schema.number()
    .default(600)
    .min(5)
    .default(600)
    .description("意愿值衰减到一半所需的时间（秒）"),
  probabilityThreshold: Schema.number()
    .default(55)
    .min(0)
    .default(55)
    .description("将意愿值转换为回复概率的激活门槛"),
  probabilityAmplifier: Schema.number()
    .default(0.04)
    .min(0.01)
    .max(1)
    .default(0.04)
    .description("概率放大系数"),
  replyCost: Schema.number()
    .default(35)
    .min(0)
    .default(35)
    .description('决定回复后，扣除的"发言精力惩罚"'),
  // refractoryPeriodMs: Schema.computed<Schema<number>>(Schema.number())
  //     .min(0)
  //     .default(3000)
  //     .description("回复后的“不应期”（毫秒），防止AI连续发言"),
});

interface MessageContext {
  chatId: string;
  content: string;
  //isImage: boolean;
  //isEmoji: boolean;
  isMentioned: boolean;
  // isQuote: boolean;
  isDirect: boolean;
}

export class WillingnessManager {
  private ctx: Context;
  private readonly baseConfig: WillingnessConfig;
  private logger: Logger;

  // --- 状态存储 ---
  private willingnessScores: Map<string, number> = new Map();
  private lastMessageTimestamps: Map<string, number> = new Map(); // 记录每个对话的最后消息时间，用于计算热度

  private decayInterval: NodeJS.Timeout | null = null;

  constructor(ctx: Context, config: WillingnessConfig, logger: Logger) {
    this.ctx = ctx;
    this.baseConfig = config;
    this.logger = logger;

    ctx.on("dispose", () => {
      this.stopDecayCycle();
    });
  }

  public stopDecayCycle(): void {
    if (this.decayInterval) {
      clearInterval(this.decayInterval);
      this.decayInterval = null;
    }
  }

  private _decay(): void {
    const now = Date.now();
    for (const chatId of this.willingnessScores.keys()) {
      const { decayHalfLifeSeconds, probabilityThreshold } = this.baseConfig;

      const currentScore = this.willingnessScores.get(chatId) || 0;
      if (currentScore === 0) continue;

      // --- 智能衰减逻辑 ---
      const baseFactor = Math.pow(0.5, 1 / decayHalfLifeSeconds);
      let effectiveFactor = baseFactor;

      // 1. 弹性衰减：意愿值高时，衰减减慢
      if (currentScore > probabilityThreshold) {
        effectiveFactor = 1.0 - (1.0 - baseFactor) * 0.5; // 衰减强度减半
      }

      // 2. 对话热度：如果最近有消息，衰减进一步减慢
      const lastMsgTime = this.lastMessageTimestamps.get(chatId) || 0;
      const silenceDurationMs = now - lastMsgTime;

      if (silenceDurationMs < 15000) {
        // 15秒内有消息，视为"热"
        effectiveFactor = 1.0 - (1.0 - effectiveFactor) * 0.3; // 衰减强度再减70%
      } else if (silenceDurationMs < 60000) {
        // 1分钟内，视为"温"
        effectiveFactor = 1.0 - (1.0 - effectiveFactor) * 0.7; // 衰减强度再减30%
      }
      // 超过1分钟，按原衰减速度

      const newScore = currentScore * effectiveFactor;
      this.willingnessScores.set(chatId, newScore < 0.01 ? 0 : newScore);
    }
  }

  /**
   * 核心计算方法: 根据上下文计算意愿增益
   * 增益计算逻辑: "边际递减"
   * @param context 消息上下文
   * @returns 本次消息产生的意愿增益值
   */
  private calculateGain(context: MessageContext): number {
    // 1. 确定基础分
    let score = this.baseConfig.text;

    // 2. 叠加属性加成
    if (context.isMentioned) score += this.baseConfig.atMention;
    // if (context.isQuote) score += attribute.isQuote;
    if (context.isDirect) score += this.baseConfig.isDirectMessage;

    // 3. 应用兴趣度乘数
    const hasKeyword = this.baseConfig.keywords.some((kw) => context.content.includes(kw));
    const multiplier = hasKeyword
      ? this.baseConfig.keywordMultiplier
      : this.baseConfig.defaultMultiplier;

    const rawGain = score * multiplier;

    // 4. 应用增益的边际递减效应
    const currentWillingness = this.willingnessScores.get(context.chatId) || 0;
    const maxWillingness = this.baseConfig.maxWillingness;
    // 当意愿值越高时，新的增益效果越差，防止无限累积
    const gainMultiplier = 1 - Math.pow(currentWillingness / maxWillingness, 2);

    return rawGain * Math.max(0, gainMultiplier);
  }

  /**
   * 公开接口：更新意愿值并返回回复概率
   * @param context 消息上下文
   * @returns 回复概率 (0-1)
   */
  private calculateReplyProbability(context: MessageContext): number {
    const { chatId } = context;

    const resolvedMaxWillingness = this.baseConfig.maxWillingness;
    const resolvedProbabilityThreshold = this.baseConfig.probabilityThreshold;
    const resolvedProbabilityAmplifier = this.baseConfig.probabilityAmplifier;

    const gain = this.calculateGain(context);
    let currentWillingness = this.willingnessScores.get(chatId) || 0;

    // --- 非线性增益 ---
    const gainMultiplier = getDynamicGainMultiplier(currentWillingness, resolvedMaxWillingness);
    const effectiveGain = gain * gainMultiplier;

    currentWillingness += effectiveGain;
    // -------------------------

    currentWillingness = Math.min(currentWillingness, resolvedMaxWillingness);
    this.willingnessScores.set(chatId, currentWillingness);

    // 转换为概率
    if (currentWillingness <= resolvedProbabilityThreshold) {
      return 0;
    }
    const probability =
      (currentWillingness - resolvedProbabilityThreshold) * resolvedProbabilityAmplifier;

    return Math.max(0, Math.min(1, probability));
  }

  /**
   * 获取指定聊天的当前意愿值（用于调试和监控）。
   * @param chatId 聊天ID
   */
  private getCurrentWillingness(chatId: string): number {
    return this.willingnessScores.get(chatId) || 0;
  }

  /**
   * 核心决策方法：判断是否应该回复。
   * @param event 平台事件
   * @param triggerCandidate 是否为触发候选
   * @returns 一个包含决策结果的对象
   */
  public shouldReply(event: PlatformEvent, triggerCandidate: boolean): { decision: boolean } {
    const { source } = event;
    const chatId = `${source.platform}:${source.channelId}`;
    if (event.type !== "message") return { decision: false };

    const content = typeof event.content === "string" ? event.content : "";

    const context: MessageContext = {
      chatId,
      content,
      isMentioned: triggerCandidate,
      isDirect: event.source.sourceType === "private",
    };

    this.logger.debug(
      `[${chatId}] 计算回复意愿 - 内容: "${context.content}", 被@: ${context.isMentioned}, 私聊: ${context.isDirect}`,
    );

    const probability = this.calculateReplyProbability(context);

    this.logger.debug(
      `[${chatId}] 当前意愿值: ${this.getCurrentWillingness(chatId).toFixed(2)}, 回复概率: ${(probability * 100).toFixed(2)}%`,
    );

    const decision = Math.random() < probability;

    this.logger.debug(
      `[${chatId}] 回复决策: ${decision ? "回复" : "不回复"} (随机值: ${(Math.random() * 100).toFixed(2)}%`,
    );

    return { decision };
  }
}

/**
 * S型曲线增益
 * @param current
 * @param max
 * @returns
 */
function getDynamicGainMultiplier(current: number, max: number): number {
  const ratio = current / max;

  // 定义S型曲线的几个关键点
  const activationPoint = 0.2; // A点：低于此值为启动区
  const saturationPoint = 0.8; // B点：高于此值为饱和区

  if (ratio < activationPoint) {
    // --- 启动区 ---
    // 线性增益或轻微负反馈
    return 1.0;
  } else if (ratio >= activationPoint && ratio < saturationPoint) {
    // --- 陡增区 (正反馈) ---
    // 可以设计一个放大函数，例如一个二次函数，在中间点达到峰值
    // 这是一个示例，你可以调整曲线形状
    const midpoint = (saturationPoint + activationPoint) / 2;
    const peakMultiplier = 2.0; // 峰值放大倍数
    // 简单的抛物线，开口向下
    const curve = -Math.pow((ratio - midpoint) * 2, 2) + peakMultiplier;
    return Math.max(1.0, curve); // 保证至少是1倍
  } else {
    // --- 饱和区 (负反馈) ---
    // 增益迅速下降
    // 使用你之前的负反馈模型，但更陡峭
    return 1 - (ratio - saturationPoint) / (1 - saturationPoint);
  }
}
