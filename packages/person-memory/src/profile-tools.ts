import { Schema } from "koishi";

import type { CatalogArgs, CatalogFields } from "./catalog";
import { validateProfileDocument, renderProfileDocument, type ProfileScene } from "./profile";
import type { Account, Person } from "./store";

const strings = () => Schema.array(Schema.string());
export const profileInputSchema = () =>
    Schema.union([
        Schema.string().description("兼容旧版完整纯文本画像；新画像应使用结构化对象"),
        Schema.object({
            version: Schema.const(1).required(),
            background: strings().required(),
            goals: strings().required(),
            contexts: strings().required(),
            needs: strings().required(),
            preferences: strings().required(),
            values: strings().required(),
            scenes: Schema.array(
                Schema.object({
                    key: Schema.string().required(),
                    platform: Schema.string().required(),
                    selfId: Schema.string().required(),
                    channelId: Schema.string().required(),
                    nickname: Schema.string().required(),
                    recent: Schema.object({
                        from: Schema.number().required(),
                        to: Schema.number().required(),
                        coverage: Schema.const("recorded_only").required(),
                        messageCount: Schema.natural().required(),
                        activeDays: Schema.natural().required(),
                        topics: strings().required(),
                        emotions: strings().required(),
                        events: strings().required(),
                        interactions: strings().required(),
                        disagreements: strings().required(),
                    }).required(),
                    taboos: strings().required(),
                    openers: strings().required(),
                }),
            ).required(),
            overview: Schema.string().required().description("结尾概述会按结构化字段同步生成，不单独增加事实"),
        }),
    ]).description("propose 的完整画像：长期认识、分场景近况及结尾概述；未知字段留空数组");

export const catalogParameters = () => ({
    account_ids: Schema.array(Schema.string()).description("read_many 多选人物 UUID 或账号 ID；与 all 互斥"),
    all: Schema.boolean().description("read_many 读取当前范围全部人物；过大时返回后续游标"),
    fields: Schema.union(["overview", "structured", "full"]).description("返回概述、结构化栏目或完整档案；默认概述"),
    cursor: Schema.string().description("继续上次查询；可仅传相同 action 和 cursor"),
    limit: Schema.natural().min(1).max(20).description("本页人物数，最多20；响应过大时自动分页，不截断档案"),
});

/** Keep runtime Session objects and tool bookkeeping out of immutable snapshots. */
export function catalogRequest(args: CatalogArgs): CatalogArgs {
    return {
        action: args.action,
        account_ids: args.account_ids,
        all: args.all,
        query: args.query,
        fields: args.fields,
        cursor: args.cursor,
        limit: args.limit,
    };
}

export function visibleProfile(person: Person, allowScene: (scene: ProfileScene) => boolean = () => true) {
    if (person.stale) return { profile: "", structuredProfile: undefined, overview: "", format: "stale" };
    if (!person.structuredProfile) return { profile: person.profile, structuredProfile: undefined, overview: person.profile, format: "legacy" };
    const structuredProfile = validateProfileDocument({ ...person.structuredProfile, scenes: person.structuredProfile.scenes.filter(allowScene) });
    return { profile: renderProfileDocument(structuredProfile), structuredProfile, overview: structuredProfile.overview, format: "structured" };
}

export function catalogProfile(person: Person, accounts: Account[], fields: CatalogFields, allowScene?: (scene: ProfileScene) => boolean) {
    const visible = visibleProfile(person, allowScene);
    const metadata = {
        id: person.id,
        name: person.name,
        revision: person.revision,
        provisional: person.provisional,
        locked: person.locked,
        stale: person.stale,
        identityChanged: !!person.identityChanged,
        format: visible.format,
        accounts: accounts.map((a) => ({ userId: a.userId, displayName: a.name, confidence: a.confidence, revision: a.revision })),
    };
    if (fields === "overview") return { ...metadata, overview: visible.overview };
    if (fields === "structured")
        return { ...metadata, structuredProfile: visible.structuredProfile, legacyProfile: visible.format === "legacy" ? visible.profile : undefined };
    return { ...metadata, ...visible, legacyProfile: person.stale ? undefined : person.legacyProfile };
}
