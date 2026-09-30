import { replyKey, ReplyTarget } from "./reply-control";
import { randomUUID } from "node:crypto";

/** 实际参与本条消息计算的值；不包含消息正文或模型配置中的凭据。 */
export interface WillingnessCalculation {
    gains?: { text: number; at: number; quote: number; direct: number };
    before: number;
    after: number;
    baseScore: number;
    interestMultiplier: number;
    marginalMultiplier: number;
    dynamicMultiplier: number;
    assessmentMultiplier: number;
    participationMultiplier: number;
    effectiveGain: number;
    maxWillingness: number;
    threshold: number;
    amplifier: number;
    probability: number;
    roll: number;
}

export interface DecisionRecord {
    version: 1;
    id: string;
    key: string;
    time: number;
    startedAt: number;
    target: ReplyTarget;
    stimulusType: string;
    stage: string;
    reason?: string;
    decision?: boolean;
    calculation?: WillingnessCalculation;
    allowed?: string[];
    assessment?: {
        mode: "off" | "observe" | "adjust";
        multiplier: number | null;
        status: "bypassed" | "pending" | "completed" | "unavailable" | "cancelled";
        answers?: { addressed: number; interested: number; others: number };
    };
    participation?: { active: boolean; lastReplyAt?: number; expiresAt?: number; participantId?: string };
    score?: number;
    probability?: number;
    roll?: number;
    success?: boolean;
}

/** 有界的消息决策快照。较旧任务的异步结果不会覆盖新消息，取消是终态。 */
export class DecisionRecords {
    private readonly instanceId = randomUUID();
    private sequence = 0;
    private records = new Map<string, DecisionRecord>();
    private latestIds = new Map<string, string>();
    constructor(
        private readonly capacity = 1000,
        private readonly now = Date.now,
        private readonly recorded?: (record: DecisionRecord) => void
    ) {}

    public begin(target: ReplyTarget, stimulusType: string): string {
        const time = this.now();
        const id = `${this.instanceId}-${time}-${++this.sequence}`;
        const key = replyKey(target);
        const record: DecisionRecord = {
            version: 1,
            id,
            key,
            time,
            startedAt: time,
            target: { ...target },
            stimulusType,
            stage: "received",
        };
        this.records.set(id, record);
        this.latestIds.set(key, id);
        while (this.records.size > this.capacity) {
            const oldest = this.records.keys().next().value;
            const removed = this.records.get(oldest)!;
            this.records.delete(oldest);
            if (this.latestIds.get(removed.key) === oldest) this.latestIds.delete(removed.key);
        }
        this.recorded?.(structuredClone(record));
        return id;
    }

    public update(id: string | undefined, update: Partial<Omit<DecisionRecord, "id" | "key" | "version" | "target" | "startedAt">>): void {
        const record = this.records.get(id);
        if (!record || record.stage === "cancelled") return;
        const defined = Object.fromEntries(Object.entries(update).filter(([, value]) => value !== undefined));
        Object.assign(record, structuredClone(defined), { time: this.now() });
        if (Object.prototype.hasOwnProperty.call(update, "reason") && update.reason === undefined) delete record.reason;
        this.recorded?.(structuredClone(record));
    }

    public latest(target: ReplyTarget): DecisionRecord | undefined {
        const record = this.records.get(this.latestIds.get(replyKey(target)));
        return record ? structuredClone(record) : undefined;
    }
}

export interface DecisionState {
    score: number;
    busy: boolean;
    assessing: boolean;
    muted: boolean;
    participation: { active: boolean; expiresAt?: number };
    suppression?: { blocked: string[]; expiresAt: number | null };
}

const stages: Record<string, string> = {
    received: "已收到",
    assessing: "语义判断中",
    calculated: "已计算",
    scheduled: "已接受调度",
    debounced: "等待消息合并",
    queued: "等待当前回复完成",
    deferred: "等待安静期",
    skipped: "已跳过",
    running: "正在回复",
    completed: "处理完成",
    cancelled: "已取消",
    blocked: "已阻止",
    failed: "处理失败",
};
const reasons: Record<string, string> = {
    stopped: "插件已停止",
    reply_suppressed: "回复受到抑制",
    permission_denied: "会话未获许可",
    muted: "机器人被禁言",
    probability_roll: "随机判定",
    below_threshold: "意愿未超过阈值",
    busy: "会话正忙",
    debounce_replaced: "被合并后的新消息替代",
    assessment_replaced: "语义判断被新消息替代",
    pause: "暂停会话",
    resume: "解除暂停",
    replace: "替换暂停规则",
    expired: "暂停规则到期",
    no_reply: "没有成功发送回复",
    exception: "处理出现异常",
    disposed: "插件已停止",
    not_scheduled: "只结算意愿，不调度回复",
    invalid_generation: "会话状态已变化",
};

export function describeDecisionStage(stage: string): string {
    return stages[stage] || stage;
}

export function formatDecision(record: DecisionRecord | undefined, state: DecisionState): string {
    const lines = [
        `当前意愿：${state.score.toFixed(2)}；回复任务：${state.busy ? "忙" : "空闲"}；语义判断：${state.assessing ? "进行中" : "无"}；禁言：${state.muted ? "是" : "否"}`,
        `参与保持：${state.participation.active ? `生效至 ${new Date(state.participation.expiresAt).toISOString()}` : "未生效"}`,
        `回复抑制：${state.suppression ? `${state.suppression.blocked.join(", ") || "无"}；${state.suppression.expiresAt === null ? "永久" : new Date(state.suppression.expiresAt).toISOString()}` : "无"}`,
        "冷却：当前意愿系统未启用回复不应期。",
    ];
    if (!record) return [...lines, "本次启动以来尚无该会话的决策记录。"].join("\n");
    lines.push(
        `最近决策：${record.id}（${new Date(record.startedAt).toISOString()}）`,
        `状态：${stages[record.stage] || record.stage}${record.reason ? `；原因：${reasons[record.reason] || record.reason}` : ""}`
    );
    const c = record.calculation;
    if (c) {
        if (c.gains) lines.push(`增益来源：文本 ${c.gains.text}；@ ${c.gains.at}；引用 ${c.gains.quote}；私聊 ${c.gains.direct}`);
        lines.push(
            `意愿：${c.before.toFixed(2)} → ${c.after.toFixed(2)}；增益：${c.effectiveGain.toFixed(2)}；阈值：${c.threshold}`,
            `基础分：${c.baseScore}；兴趣乘数：${c.interestMultiplier}；边际乘数：${c.marginalMultiplier.toFixed(3)}；动态乘数：${c.dynamicMultiplier.toFixed(3)}`,
            `语义乘数：${c.assessmentMultiplier.toFixed(3)}；参与乘数：${c.participationMultiplier.toFixed(3)}`
        );
    }
    if (record.probability !== undefined || record.roll !== undefined)
        lines.push(
            `回复概率：${record.probability === undefined ? "未计算" : `${(record.probability * 100).toFixed(1)}%`}；随机数：${record.roll ?? "未抽取"}；判定：${record.decision === undefined ? "未判定" : record.decision ? "回复" : "不回复"}`
        );
    if (record.assessment)
        lines.push(
            `语义判断：${record.assessment.mode} / ${record.assessment.status}；已有结果乘数：${record.assessment.multiplier ?? "不可用"}`
        );
    if (record.assessment?.answers) {
        const a = record.assessment.answers;
        lines.push(`语义评分：面向机器人 ${a.addressed}；兴趣匹配 ${a.interested}；面向他人 ${a.others}`);
    }
    if (record.success !== undefined) lines.push(`成功发送回复：${record.success ? "是" : "否"}`);
    return lines.join("\n");
}
