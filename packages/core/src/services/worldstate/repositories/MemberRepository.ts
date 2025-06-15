import { Context } from "koishi";
import { Member } from "../interfaces";

export class MemberRepository {
    constructor(private ctx: Context) {}

    /**
     * 根据一组平台用户ID (pids)，高效地获取他们在一个频道中的完整 Member 对象。
     * @param platform - 平台名称
     * @param channelId - 频道ID
     * @param pids - 平台用户ID (如QQ号) 的数组
     * @returns 返回一个包含完整 Member 信息的数组
     */
    async getFullMembersByPids(platform: string, channelId: string, pids: string[]): Promise<Member[]> {
        // 如果传入的 pids 数组为空，直接返回空数组，避免无效的数据库查询
        if (!pids || pids.length === 0) {
            return [];
        }

        // --- 第 1 步: 从 pids 找到内部 bids) from platform IDs (pids).
        const bindingRecords = await this.ctx.database.get("binding", { platform, pid: pids });
        const bids = bindingRecords.map((b) => b.bid);
        if (bids.length === 0) {
            // 如果没有找到任何匹配的内部用户，也直接返回
            return [];
        }

        // 创建一个 bid -> pid 的反向映射，方便后续组装
        const bidToPidMap = new Map(bindingRecords.map((b) => [b.bid, b.pid]));

        // --- 第 2 步: 使用 bids 并行查询 user 和 member 表 ---
        const [userRecords, memberRecords] = await Promise.all([
            this.ctx.database.get("user", { id: bids }),
            this.ctx.database.get("members", { userId: bids, platform, channelId }),
        ]);

        // --- 第 3 步: 在内存中高效组合数据 ---

        // 创建 Map 以便快速查找，这是避免 O(n^2) 循环的关键
        const userMap = new Map(userRecords.map((u) => [u.id, u]));
        const memberMap = new Map(memberRecords.map((m) => [m.userId, m]));

        const result: Member[] = [];

        // 遍历我们找到的内部 bids，而不是原始的 pids，因为有些 pid 可能不存在
        for (const bid of bids) {
            const userRecord = userMap.get(bid);
            const memberRecord = memberMap.get(bid);
            const pid = bidToPidMap.get(bid);

            // 必须要有对应的 user 记录和 binding 记录才能构成一个有效的 Member
            if (!userRecord || !pid) {
                continue;
            }

            // memberRecord 是可选的，如果一个用户存在但从未在该频道发言或被记录，
            // 他可能没有 member 记录。我们可以创建一个默认的。
            const nick = memberRecord?.nick ?? userRecord.name;
            const role = memberRecord?.role;
            const lastActive = memberRecord?.lastActive;

            result.push({
                // User 部分
                id: pid, // 对外暴露的是平台ID
                name: userRecord.name ?? "未知用户",
                created_at: userRecord.createdAt,
                updated_at: userRecord.updatedAt,

                // Member 特有部分
                channel_id: channelId,
                last_active: lastActive?.toISOString(),
                meta: {
                    avatar: userRecord.avatar,
                    nick: nick,
                    role: role,
                },
            });
        }
        return result;
    }

    /**
     * 获取指定频道的所有成员的完整信息 (可以复用 getFullMembersByPids)
     */
    async getFullMembers(platform: string, channelId: string): Promise<Member[]> {
        // 获取该频道所有成员的记录
        const memberRecords = await this.ctx.database.get("members", { platform, channelId });
        const bids = memberRecords.map((m) => m.userId);
        if (bids.length === 0) return [];

        // 获取这些内部ID对应的平台ID
        const bindingRecords = await this.ctx.database.get("binding", { bid: bids, platform });
        const pids = bindingRecords.map((b) => b.pid);

        return this.getFullMembersByPids(platform, channelId, pids);
    }
}
