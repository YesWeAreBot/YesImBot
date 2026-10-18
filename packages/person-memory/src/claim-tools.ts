import { Schema } from "koishi";

import { claimCategories, claimEvidence, evidenceRoot, type Claim, type ClaimChange } from "./claims";
import type { Evidence, Person, PersonStore } from "./store";

export const claimParameters = () => ({
    claim_id: Schema.string().description("claim_evidence 必填；claims 返回的逐条认识 ID"),
    changes: Schema.array(
        Schema.object({
            action: Schema.union(["support", "counter", "revise", "retire"]).required(),
            claimId: Schema.string(),
            expectedRevision: Schema.natural(),
            category: Schema.union([...claimCategories]),
            scene: Schema.string(),
            statement: Schema.string(),
            messageIds: Schema.array(Schema.string()).required().description("原始证据ID；停用可为空，其他操作需1–10个"),
        }),
    ).description("propose_claim 的逐条变更；已有认识需 claimId 和 expectedRevision，分类及场景不可偷换"),
});

export function claimSummary(claim: Claim) {
    return {
        id: claim.id,
        revision: claim.revision,
        category: claim.category,
        scene: claim.scene,
        statement: claim.statement,
        status: claim.status,
        action: claim.action,
        updatedAt: claim.createdAt,
        evidenceCount: claimEvidence(claim).length,
        historyCount: claim.history.length,
        scope: claim.scene ? { kind: "scene", scene: claim.scene } : { kind: "person" },
    };
}
export function visibleClaims(person: Person, allow: (claim: Claim) => boolean = () => true) {
    return (person.claims || []).filter(allow).map(claimSummary);
}

interface ClaimToolContext {
    store: PersonStore;
    scope: string;
    ref: string;
    active: () => boolean;
    allowClaim: (claim: Claim) => boolean;
    allowEvidence: (evidence: Evidence) => boolean;
    sourceId: (id: string) => string;
}
/** Read evidence as original observations, never as new independent support. */
export async function executeClaimTool(args: any, context: ClaimToolContext): Promise<unknown> {
    const { store, scope, ref, active, allowClaim, allowEvidence, sourceId } = context;
    const found = await store.find(scope, ref);
    if (!found || !active()) throw new Error("当前范围没有此人物或查询权限已变化");
    const signature = JSON.stringify([found.person, found.accounts]);
    const current = async () => {
        const state = await store.read(scope);
        const person = state.people[found.person.id];
        const latest = person ? { person, accounts: Object.values(state.accounts).filter((account) => account.personId === person.id) } : undefined;
        if (!active() || state.settings.mode === "off" || !latest || JSON.stringify([latest.person, latest.accounts]) !== signature)
            throw new Error("人物、权限或维护模式已改变，请重新读取");
    };
    const page = (items: unknown[]) => {
        const offset = args.offset ?? 0,
            limit = args.limit ?? 10;
        if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new Error("无效分页参数");
        const selected = items.slice(offset, offset + limit);
        return {
            items: selected,
            total: items.length,
            offset,
            returned: selected.length,
            hasMore: offset + selected.length < items.length,
            ...(offset + selected.length < items.length ? { nextOffset: offset + selected.length } : {}),
        };
    };
    if (args.action === "claims") {
        const claims = (await store.readClaims(scope, ref)).filter(allowClaim);
        const result = page(claims.map(claimSummary));
        await current();
        if (claims.some((claim) => !allowClaim(claim))) throw new Error("认识的场景权限已变化");
        return { ...result, personId: found.person.id, personRevision: found.person.revision };
    }
    if (args.action === "claim_evidence") {
        const claim = await store.findClaim(scope, ref, args.claim_id);
        if (!claim || !allowClaim(claim)) throw new Error("当前范围没有此认识");
        const accountIds = new Set(found.accounts.map((account) => account.userId));
        const evidence = (await store.claimEvidence(scope, ref, claim.id)).filter((item) => accountIds.has(item.userId) && allowEvidence(item));
        const result = page(
            evidence.map((item) => {
                const root = evidenceRoot(item);
                return {
                    ...item,
                    evidenceRoot: root,
                    isNewEvidence: false,
                    uses: claim.history
                        .filter((revision) => revision.evidence.some((source) => evidenceRoot(source) === root))
                        .map((revision) => ({
                            revision: revision.revision,
                            action: revision.action,
                            status: revision.status,
                            statement: revision.statement,
                            createdAt: revision.createdAt,
                        })),
                };
            }),
        );
        await current();
        if (!allowClaim(claim) || evidence.some((item) => !allowEvidence(item))) throw new Error("证据的来源权限已变化");
        return { ...result, claimId: claim.id, claimRevision: claim.revision, status: claim.status, projection: "original_evidence_read_not_new_support" };
    }
    if (args.action !== "propose_claim" || !Array.isArray(args.changes) || !args.changes.length || args.changes.length > 20)
        throw new Error("请提供1–20项逐条认识变更");
    if (typeof args.person_id !== "string" || !Number.isSafeInteger(args.person_revision) || !Number.isSafeInteger(args.account_revision))
        throw new Error("请先read并提供最新人物和账号版本");
    const changes: ClaimChange[] = args.changes.map((change: ClaimChange) => ({
        ...change,
        messageIds: Array.isArray(change.messageIds) ? change.messageIds.map(sourceId) : change.messageIds,
    }));
    const sources = await store.profileSources(scope, ref, 0);
    const allSources: Evidence[] = [];
    for (const change of changes) {
        const existing = change.claimId && (await store.findClaim(scope, ref, change.claimId));
        if (existing && !allowClaim(existing)) throw new Error("当前场景不能修改此认识");
        for (const id of change.messageIds || []) {
            const source = sources.find((item) => item.id === id);
            if (!source || !allowEvidence(source)) throw new Error("认识来源不在当前允许范围");
            allSources.push(source);
        }
    }
    await current();
    const stillAllowed = () => active() && allSources.every(allowEvidence);
    const proposal = await store.proposeClaims(
        scope,
        ref,
        changes,
        "main-model",
        { personId: args.person_id, personRevision: args.person_revision, accountRevision: args.account_revision },
        stillAllowed,
    );
    return { id: proposal.id, type: "claim", personId: proposal.personId, state: proposal.state };
}
