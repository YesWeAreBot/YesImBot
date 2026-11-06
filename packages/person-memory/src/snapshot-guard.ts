import { createHash } from "node:crypto";

const expired = () => ({ notice: "人物记忆快照已过期，请重新查询当前允许的资料。" });

/** Authorization belongs to a rendered snapshot, never to the immutable audit. */
export function personSnapshotGuard(ctx: any, fingerprint: (session: any) => Promise<unknown>, register = true) {
    const snapshot = async (session: any) =>
        createHash("sha256")
            .update(JSON.stringify(await fingerprint(session)))
            .digest("hex");
    const isResultCurrent = async (result: any, session: any) => {
        const token = result?.metadata?.personMemorySnapshot;
        if (typeof token !== "string") return false;
        try {
            return token === (await snapshot(session));
        } catch {
            return false;
        }
    };
    // Background queries and archived output reads can wrap the original result.
    // Revalidate every marked payload without mutating the persisted observation.
    const sanitize = async (value: any, session: any): Promise<any> => {
        if (!value || typeof value !== "object") return value;
        if (value.metadata?.personMemorySnapshot && !(await isResultCurrent(value, session))) return expired();
        if (Array.isArray(value)) {
            const projected = await Promise.all(value.map((item) => sanitize(item, session)));
            return projected.every((item, index) => item === value[index]) ? value : projected;
        }
        const entries = await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await sanitize(item, session)] as const));
        return entries.every(([key, item]) => item === value[key]) ? value : Object.fromEntries(entries);
    };
    const project = async (session: any, state: any) => {
        const memory = state.l1_working_memory;
        if (!memory) return;
        for (const key of ["new_events", "processed_events"]) {
            if (!Array.isArray(memory[key])) continue;
            memory[key] = await Promise.all(
                memory[key].map(async (event: any) => {
                    if (event.type !== "agent_observation") return event;
                    const personTool = ["person_memory", "person_recall"].includes(event.function);
                    if (personTool || event.metadata?.personMemorySnapshot) {
                        if (!(await isResultCurrent(event.metadata ? { metadata: event.metadata } : event.result, session)))
                            return { ...event, result: expired(), error: undefined, metadata: undefined };
                    }
                    const result = await sanitize(event.result, session);
                    return result === event.result ? event : { ...event, result };
                }),
            );
        }
    };
    if (register) ctx.on("yesimbot/filter-recalled-memory", project);
    const wrap = (tool: any) => ({
        ...tool,
        isResultCurrent,
        execute: async (args: any) => {
            const before = await snapshot(args.session).catch(() => undefined);
            const result = await tool.execute(args);
            if (result.status !== "success") return result;
            try {
                const token = await snapshot(args.session);
                if (
                    (tool.name === "person_recall" || ["read", "read_many", "list", "search", "history", "claims", "claim_evidence"].includes(args.action)) &&
                    before !== token
                )
                    throw new Error("人物记忆快照已改变");
                return { ...result, metadata: { ...result.metadata, personMemorySnapshot: token } };
            } catch {
                return { status: "error", error: { name: "PersonMemoryError", message: "人物资料或查询权限已改变，请重新查询" } };
            }
        },
    });
    return Object.assign(wrap, { project });
}
