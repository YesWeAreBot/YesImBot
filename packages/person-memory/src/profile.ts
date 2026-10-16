/** Additive, bounded long-term profile format. Unknown facts remain empty arrays. */
export interface ProfileScene {
    key: string;
    platform: string;
    selfId: string;
    channelId: string;
    nickname: string;
    recent: {
        from: number;
        to: number;
        coverage: "recorded_only";
        messageCount: number;
        activeDays: number;
        topics: string[];
        emotions: string[];
        events: string[];
        interactions: string[];
        disagreements: string[];
    };
    taboos: string[];
    openers: string[];
}
export interface ProfileDocument {
    version: 1;
    background: string[];
    goals: string[];
    contexts: string[];
    needs: string[];
    preferences: string[];
    values: string[];
    scenes: ProfileScene[];
    overview: string;
}
const categories = { background: "背景", goals: "目标", contexts: "处境", needs: "需求", preferences: "偏好", values: "价值观" } as const;
const recentCategories = { topics: "话题", emotions: "情绪", events: "事件", interactions: "互动", disagreements: "分歧" } as const;
function object(input: unknown, keys: string[]): Record<string, unknown> {
    if (!input || typeof input !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(input)) || Array.isArray(input))
        throw new Error("画像字段必须为普通对象");
    const own = Reflect.ownKeys(input);
    if (own.length !== keys.length || own.some((key) => typeof key !== "string" || !keys.includes(key))) throw new Error("画像字段不完整或包含未知字段");
    return input as Record<string, unknown>;
}
function string(input: unknown, max: number, empty = false): string {
    if (typeof input !== "string" || input.length > max || (!empty && !input.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input))
        throw new Error("画像文本为空、过长或含控制字符");
    return input.trim();
}
function list(input: unknown, max = 20): string[] {
    if (!Array.isArray(input) || input.length > max) throw new Error(`画像列表最多 ${max} 项`);
    return Array.from(input, (item) => string(item, 400));
}
function count(input: unknown, max = Number.MAX_SAFE_INTEGER): number {
    if (typeof input !== "number" || !Number.isSafeInteger(input) || input < 0 || input > max) throw new Error("画像统计数字无效");
    return input;
}
function overview(doc: Omit<ProfileDocument, "overview">): string {
    const facts = Object.entries(categories).flatMap(([key, label]) =>
        (doc[key as keyof typeof categories] as string[]).slice(0, 2).map((value) => `${label}：${value}`),
    );
    for (const scene of doc.scenes) {
        const details = [`仅已记录消息 ${scene.recent.messageCount} 条，活跃日期 ${scene.recent.activeDays} 个（UTC）`];
        for (const [key, label] of Object.entries(recentCategories)) {
            const values = scene.recent[key as keyof typeof recentCategories].slice(0, 2);
            if (values.length) details.push(`${label}：${values.join("、")}`);
        }
        if (scene.taboos.length) details.push(`禁忌：${scene.taboos.slice(0, 2).join("、")}`);
        if (scene.openers.length) details.push(`开场方式：${scene.openers.slice(0, 2).join("、")}`);
        facts.push(
            `场景 ${scene.nickname || scene.channelId}（记录快照 ${new Date(scene.recent.from).toISOString()} 至 ${new Date(scene.recent.to).toISOString()}）：${details.join("；")}`,
        );
    }
    return facts.length ? facts.join("；") : "暂无已记录画像信息。";
}
/** The overview is generated from normalized current fields; supplied prose is never trusted. */
export function validateProfileDocument(input: unknown): ProfileDocument {
    const source = object(input, ["version", ...Object.keys(categories), "scenes", "overview"]);
    if (source.version !== 1) throw new Error("画像版本必须为 1");
    string(source.overview, 12000, true);
    const doc = { version: 1 } as ProfileDocument;
    for (const key of Object.keys(categories) as Array<keyof typeof categories>) doc[key] = list(source[key]);
    if (!Array.isArray(source.scenes) || source.scenes.length > 12) throw new Error("画像场景最多 12 个");
    const keys = new Set<string>();
    doc.scenes = Array.from(source.scenes, (input) => {
        const s = object(input, ["key", "platform", "selfId", "channelId", "nickname", "recent", "taboos", "openers"]);
        const r = object(s.recent, ["from", "to", "coverage", "messageCount", "activeDays", ...Object.keys(recentCategories)]);
        const scene = {} as ProfileScene;
        for (const key of ["key", "platform", "selfId", "channelId", "nickname"] as const) scene[key] = string(s[key], 256, key === "nickname");
        if (keys.has(scene.key)) throw new Error("画像场景重复");
        keys.add(scene.key);
        if (r.coverage !== "recorded_only") throw new Error("画像统计仅支持已记录消息");
        scene.recent = {
            from: count(r.from, 8640000000000000),
            to: count(r.to, 8640000000000000),
            coverage: "recorded_only",
            messageCount: count(r.messageCount),
            activeDays: count(r.activeDays, 8),
            topics: list(r.topics, 5),
            emotions: list(r.emotions),
            events: list(r.events),
            interactions: list(r.interactions),
            disagreements: list(r.disagreements),
        };
        if (scene.recent.from > scene.recent.to) throw new Error("画像时间范围无效");
        scene.taboos = list(s.taboos);
        scene.openers = list(s.openers);
        return scene;
    });
    doc.overview = overview(doc);
    if (JSON.stringify(doc).length > 12000) throw new Error("结构画像超过 12000 字符");
    return doc;
}
export function renderProfileDocument(input: ProfileDocument): string {
    const doc = validateProfileDocument(input);
    const lines = Object.entries(categories).map(([key, label]) => `${label}：${(doc[key as keyof typeof categories] as string[]).join("；") || "暂无记录"}`);
    lines.push("分场景记录快照（仅已记录消息；时间范围如下）：");
    for (const scene of doc.scenes) {
        lines.push(
            `场景：${scene.nickname || scene.channelId} [${scene.platform}/${scene.selfId}/${scene.channelId}]`,
            `记录范围：${new Date(scene.recent.from).toISOString()} 至 ${new Date(scene.recent.to).toISOString()}；消息 ${scene.recent.messageCount} 条；活跃日期 ${scene.recent.activeDays} 个（UTC）`,
        );
        for (const [key, label] of Object.entries(recentCategories))
            lines.push(`${label}：${scene.recent[key as keyof typeof recentCategories].join("；") || "暂无记录"}`);
        lines.push(`禁忌：${scene.taboos.join("；") || "暂无记录"}`, `开场方式：${scene.openers.join("；") || "暂无记录"}`);
    }
    lines.push(`结尾总览：${doc.overview}`);
    return lines.join("\n");
}
