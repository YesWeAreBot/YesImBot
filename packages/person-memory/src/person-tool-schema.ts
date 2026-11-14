import { Schema } from "koishi";

import { claimParameters } from "./claim-tools";
import { catalogParameters, profileInputSchema } from "./profile-tools";

/** Use one flat object for native tool schemas and legacy action templates. */
export function personToolContract(shared: boolean) {
    const versionFields = "person_id, person_revision, account_revision";
    const actions = {
        list: "list([query, fields, limit, cursor]) 列出人物",
        read_many: "read_many(account_ids 或 all=true, [query, fields, limit, cursor]) 批量读取人物",
        read: "read(account_id) 读取单个人物与最新版本",
        search: "search(query) 返回最多五个匹配摘要",
        history: "history(account_id) 查看最近十次修改记录",
        claims: "claims(account_id, [offset, limit]) 列出逐条认识与版本",
        claim_evidence: "claim_evidence(account_id, claim_id, [offset, limit]) 读取一条认识的原始证据",
        propose_claim: `propose_claim(account_id, ${versionFields}, changes) 补证、反证、修订或停用逐条认识`,
        propose: `propose(account_id, ${versionFields}, message_ids, profile) 提交完整画像，已启用逐条认识的人物请用 propose_claim`,
        propose_link: `propose_link(account_id, ${versionFields}, message_ids, target_person_id, target_revision, confidence, reason) 提交账号关联建议，需人工审核`,
    };
    const scope = shared
        ? "仅操作有权限的共同域场景。account_id 可为当前平台账号 ID、人物 UUID 或 JSON [平台,ID]。"
        : "仅操作当前场景。读取可用平台账号 ID 或人物 UUID，提交候选须用平台账号 ID。";
    const description = [
        scope,
        "按 action 仅提供下列字段，方括号表示可选项。",
        ...Object.values(actions),
        "list 与 read_many 继续分页时只需使用原 action 和 cursor。提交变更前先 read 获取版本，锁定、暂停与版本校验始终生效。",
        "review 模式需人工审核；auto 模式可自动接受画像候选，账号关联建议仍需人工审核。",
    ].join("\n");
    // Preserve the existing validation differences between scene and shared mode.
    const revision = () => (shared ? Schema.number() : Schema.number().min(0).step(1));
    const confidence = shared ? Schema.number() : Schema.number().min(0).max(1);
    const parameters = Schema.object({
        action: Schema.union(Object.keys(actions).map((action) => Schema.const(action))).required(),
        account_id: Schema.string().description("read、history、claims、claim_evidence、propose、propose_link、propose_claim 必填"),
        query: Schema.string().description("search 必填（1–80 字）；list/read_many 可选，用于筛选本次查询"),
        profile: profileInputSchema(),
        ...catalogParameters(),
        ...claimParameters(),
        offset: Schema.natural().description("claims/claim_evidence 专用；用 nextOffset 继续分页"),
        message_ids: Schema.array(Schema.string()).description(
            shared
                ? "propose/propose_link 必填，1–10 个；当前场景用消息 ID，跨场景使用有权读取的来源编号"
                : "propose/propose_link 必填，1–10 个当前场景实际消息 ID",
        ),
        person_id: Schema.string().description("propose/propose_link/propose_claim 必填；来源人物 UUID"),
        person_revision: revision().description("propose/propose_link/propose_claim 必填；read 返回的来源人物版本"),
        account_revision: revision().description("propose/propose_link/propose_claim 必填；read 返回的账号关联版本"),
        target_person_id: Schema.string().description("propose_link 专用且必填；目标人物 UUID"),
        target_revision: revision().description("propose_link 专用且必填；目标人物版本"),
        confidence: confidence.description("propose_link 专用且必填；0–1 的关联确信度"),
        reason: Schema.string().description("propose_link 专用且必填；1–500 字的关联依据"),
    });
    return { description, parameters };
}
