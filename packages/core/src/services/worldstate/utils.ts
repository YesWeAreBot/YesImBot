import { h } from "koishi";
import { ClosedDialogueSegment, FoldedDialogueSegment, PendingDialogueSegment, WorldState } from "./interfaces";

/**
 * 根据最大消息数限制，修剪世界状态中的历史记录
 *
 * 此函数是不可变的：它不会修改原始的 `worldState` 对象，而是返回一个
 * 经过修剪的新的 `worldState` 对象
 * 它的裁剪最小单元是“消息”它会从最旧的对话片段中的最旧消息开始移除，
 * 直到剩余的总消息数不超过限制如果一个片段在裁剪后变为空，该片段将被移除
 *
 * @param worldState 原始的世界状态
 * @param maxMessages 允许的最大消息总数
 * @returns 一个新的、历史记录被修剪过的 `WorldState` 对象
 */
export function pruneHistoryByMessages(worldState: WorldState, maxMessages: number): WorldState {
    // 1. 为了保证不可变性，立即创建一个深拷贝所有修改都将在这个拷贝上进行
    const newWorldState = structuredClone(worldState);

    // 2. 处理边缘情况：如果允许的最大消息数为0或更少，直接清空所有历史记录
    if (maxMessages <= 0) {
        newWorldState.channel.history.pending = undefined;
        newWorldState.channel.history.closed = [];
        newWorldState.channel.history.folded = undefined;
        return newWorldState;
    }

    // 3. 收集新 worldState 中所有可操作的对话片段的引用
    const allSegments: (PendingDialogueSegment | ClosedDialogueSegment | FoldedDialogueSegment)[] = [
        newWorldState.channel.history.pending,
        ...(newWorldState.channel.history.closed || []),
        newWorldState.channel.history.folded,
    ].filter(Boolean);

    // 4. 计算当前总消息数和需要移除的消息数
    const totalMessages = allSegments.reduce((sum, seg) => sum + seg.dialogue.length, 0);
    let messagesToRemove = totalMessages - maxMessages;

    if (messagesToRemove <= 0) {
        return newWorldState; // 无需裁剪
    }

    // 5. 按时间戳升序排序片段（从最旧到最新），以便从最旧的开始删除
    allSegments.sort((a, b) => a.startTimestamp.getTime() - b.startTimestamp.getTime());

    // 6. 遍历排序后的片段，从最旧的片段中的最旧消息开始移除
    for (const segment of allSegments) {
        if (messagesToRemove <= 0) break;

        const messagesInSegment = segment.dialogue.length;
        const messagesToDeleteInThisSegment = Math.min(messagesToRemove, messagesInSegment);

        segment.dialogue.splice(0, messagesToDeleteInThisSegment);
        messagesToRemove -= messagesToDeleteInThisSegment;
    }

    // 7. 清理那些因消息被删除而变为空的片段
    newWorldState.channel.history.closed = newWorldState.channel.history.closed.filter(
        (segment) => segment.dialogue.length > 0
    );
    if (newWorldState.channel.history.folded?.dialogue.length === 0) {
        newWorldState.channel.history.folded = undefined;
    }

    // 8. 返回修改后的新 worldState
    return newWorldState;
}

/**
 * 提取消息中@提及的用户ID
 */
export function extractMentionedUsers(content: string): string[] {
    // const mentionRegex = /@(\w+)/g;
    // const mentions: string[] = [];
    // let match: RegExpExecArray | null;

    // while ((match = mentionRegex.exec(content)) !== null) {
    //     mentions.push(match[1]);
    // }

    const mentions = h
        .parse(content)
        .filter((el) => el.type === "at")
        .map((el) => el.attrs.id);

    return mentions;
}