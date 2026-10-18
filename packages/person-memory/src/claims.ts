import { randomUUID } from "node:crypto";

import { validateProfileDocument, type ProfileDocument } from "./profile";
import type { Evidence, Person } from "./store";

export const claimCategories = [
    "background",
    "goals",
    "contexts",
    "needs",
    "preferences",
    "values",
    "topics",
    "emotions",
    "events",
    "interactions",
    "disagreements",
    "taboos",
    "openers",
] as const;
export type ClaimCategory = (typeof claimCategories)[number];
export interface ClaimChange {
    action: "support" | "counter" | "revise" | "retire";
    claimId?: string;
    expectedRevision?: number;
    category?: ClaimCategory;
    scene?: string;
    statement?: string;
    messageIds: string[];
}
export interface ClaimRevision {
    revision: number;
    previousRevision?: number;
    action: ClaimChange["action"];
    statement: string;
    status: "active" | "contested" | "retired";
    evidence: Evidence[];
    createdAt: number;
}
export interface Claim extends ClaimRevision {
    id: string;
    personId: string;
    category: ClaimCategory;
    scene?: string;
    history: ClaimRevision[];
}
/** A recall alias can never turn the same original platform message into independent support. */
export function evidenceRoot(e: Evidence): string {
    const p = e.provenance;
    return p ? JSON.stringify([p.platform, p.channelId, p.messageId]) : JSON.stringify([e.userId, e.id]);
}
export function claimEvidence(claim: Claim): Evidence[] {
    return [...new Map(claim.history.flatMap((r) => r.evidence).map((e) => [evidenceRoot(e), e])).values()];
}
export function applyClaimChanges(person: Person, changes: ClaimChange[], sources: Evidence[][]): Claim[] {
    const claims = structuredClone(person.claims || []);
    if (!Array.isArray(changes) || !changes.length || changes.length > 20) throw new Error("需提供 1 到 20 项主张变更");
    for (const [i, change] of changes.entries()) {
        if (change.scene !== undefined && (typeof change.scene !== "string" || !change.scene.trim() || change.scene !== change.scene.trim()))
            throw new Error("主张场景标识无效");
        if (!["support", "counter", "revise", "retire"].includes(change.action)) throw new Error("主张操作无效");
        let claim = change.claimId ? claims.find((c) => c.id === change.claimId) : undefined;
        if (change.claimId && !claim) throw new Error("当前人物没有此主张");
        if (!claim) {
            if (change.action !== "support" || !claimCategories.includes(change.category!) || typeof change.statement !== "string" || !change.statement.trim())
                throw new Error("新主张需要分类和陈述");
            claim = claims.find((c) => c.category === change.category && c.scene === change.scene && c.statement === change.statement!.trim());
        }
        if (claim && (change.claimId || change.expectedRevision !== undefined) && change.expectedRevision !== claim.revision) throw new Error("主张版本已变化");
        if (claim && ((change.category && change.category !== claim.category) || (change.scene && change.scene !== claim.scene)))
            throw new Error("主张分类或场景不能更改");
        if (claim?.status === "retired" && change.action !== "retire" && change.action !== "revise") throw new Error("已退役主张只能通过明确修订恢复");
        const statement = change.action === "revise" || !claim ? change.statement?.trim() : claim.statement;
        if (!statement || statement.length > 400 || /[\u0000-\u001f\u007f]/.test(statement)) throw new Error("主张陈述无效");
        const used = new Set(claim ? claimEvidence(claim).map(evidenceRoot) : []);
        const evidence = [...new Map(sources[i].map((e) => [evidenceRoot(e), e])).values()].filter(
            (e) => !used.has(evidenceRoot(e)) && (claim?.status !== "retired" || e.timestamp > claim.createdAt),
        );
        if (change.action !== "retire" && !evidence.length) {
            if (claim?.status === "active" && change.action === "support") continue;
            throw new Error("修订、反证或恢复需要新的独立原始消息");
        }
        // Supporting a contested claim records support but only an explicit revision resolves conflict.
        const status =
            change.action === "retire"
                ? "retired"
                : change.action === "counter"
                  ? "contested"
                  : change.action === "revise"
                    ? "active"
                    : claim?.status === "contested"
                      ? "contested"
                      : "active";
        const revision: ClaimRevision = {
            revision: (claim?.revision || 0) + 1,
            ...(claim ? { previousRevision: claim.revision } : {}),
            action: change.action,
            statement,
            status,
            evidence: structuredClone(evidence),
            createdAt: Date.now(),
        };
        if (!claim) {
            claim = {
                ...revision,
                id: randomUUID(),
                personId: person.id,
                category: change.category!,
                ...(change.scene ? { scene: change.scene } : {}),
                history: [revision],
            };
            claims.push(claim);
        } else {
            Object.assign(claim, revision);
            claim.history.push(revision);
        }
    }
    if (claims.length > 200 || JSON.stringify(claims).length > 500000) throw new Error("主张记录达到容量限制");
    return claims;
}
export function projectClaims(person: Person, claims: Claim[]): ProfileDocument {
    const doc: ProfileDocument = structuredClone(
        person.structuredProfile || { version: 1, background: [], goals: [], contexts: [], needs: [], preferences: [], values: [], scenes: [], overview: "" },
    );
    for (const claim of claims.filter((claim) => claim.status === "active")) {
        if (!claim.scene || doc.scenes.some((s) => s.key === claim.scene)) continue;
        const evidence = claimEvidence(claim).filter(
            (e) => e.provenance && (e.provenance.scene || JSON.stringify([e.provenance.platform, e.provenance.selfId, e.provenance.channelId])) === claim.scene,
        );
        const origin = evidence[0]?.provenance;
        if (!origin) throw new Error("主张场景缺少原始来源");
        const times = evidence.map((e) => e.timestamp);
        doc.scenes.push({
            key: claim.scene,
            platform: origin.platform,
            selfId: origin.selfId,
            channelId: origin.channelId,
            nickname: evidence[0].name,
            recent: {
                from: Math.min(...times),
                to: Math.max(...times),
                coverage: "recorded_only",
                messageCount: evidence.length,
                activeDays: new Set(times.map((t) => new Date(t).toISOString().slice(0, 10))).size,
                topics: [],
                emotions: [],
                events: [],
                interactions: [],
                disagreements: [],
            },
            taboos: [],
            openers: [],
        });
    }
    // Remove every historical managed statement. Legacy facts have no invented provenance.
    for (const c of [...(person.claims || []), ...claims]) {
        if (c.scene && !doc.scenes.some((scene) => scene.key === c.scene)) continue;
        const values = c.scene ? sceneList(doc, c) : (doc[c.category as "background"] as string[]);
        if (values)
            for (const statement of new Set(c.history.map((r) => r.statement))) {
                let index;
                while ((index = values.indexOf(statement)) >= 0) values.splice(index, 1);
            }
    }
    for (const c of claims.filter((c) => c.status === "active")) {
        const values = c.scene ? sceneList(doc, c) : (doc[c.category as "background"] as string[]);
        if (!Array.isArray(values)) throw new Error("场景分类需要有效场景");
        if (!values.includes(c.statement)) values.push(c.statement);
    }
    return validateProfileDocument(doc);
}
function sceneList(doc: ProfileDocument, claim: Claim): string[] | undefined {
    const scene = doc.scenes.find((s) => s.key === claim.scene);
    if (!scene) throw new Error("主张场景需要已有来源记录的结构场景");
    if (claim.category === "taboos" || claim.category === "openers") return scene[claim.category];
    if (["topics", "emotions", "events", "interactions", "disagreements"].includes(claim.category)) return scene.recent[claim.category as "topics"];
    throw new Error("全局分类不能指定场景");
}

/** Identity corrections retain the audit trail while removing current belief. */
export function retireClaims(claims: Claim[]): Claim[] {
    return claims.map((claim) => {
        if (claim.status === "retired") return structuredClone(claim);
        const revision: ClaimRevision = {
            revision: claim.revision + 1,
            previousRevision: claim.revision,
            action: "retire",
            statement: claim.statement,
            status: "retired",
            evidence: [],
            createdAt: Date.now(),
        };
        return { ...structuredClone(claim), ...revision, history: [...structuredClone(claim.history), revision] };
    });
}
