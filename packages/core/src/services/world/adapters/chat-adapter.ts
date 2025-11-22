import type { AnyPercept, Entity, Environment, MemberEntity, Observation, UserMessagePercept } from "@/services/world/types";

import { PerceptType, TimelineEventType } from "@/services/world/types";
import { TableName } from "@/shared/constants";
import { SceneAdapter } from "./base";

/**
 * 聊天场景适配器
 *
 * 将聊天场景的数据（频道、用户、消息）转换为通用的 WorldState 抽象
 */
export class ChatSceneAdapter extends SceneAdapter {
    name = "chat";

    public canHandle(percept: AnyPercept): boolean {
        return percept.type === PerceptType.UserMessage;
    }

    async buildEnvironment(percept: UserMessagePercept): Promise<Environment> {
        const { platform, channelId } = this.extractChannelInfo(percept);

        // 从数据库获取频道信息
        const channelInfo = await this.getChannelInfo(platform, channelId);

        return {
            type: "chat_channel",
            id: `${platform}:${channelId}`,
            name: channelInfo.name || channelId,
            metadata: {
                platform,
                channelType: channelInfo.type, // "private" | "guild"
                memberCount: channelInfo.memberCount,
                // 聊天场景特定的元数据
                topic: channelInfo.topic,
                rules: channelInfo.rules,
            },
        };
    }

    async buildEntities(percept: UserMessagePercept, env: Environment): Promise<Entity[]> {
        const channelId = env.id;

        // 从数据库获取成员列表
        const members: MemberEntity[] = await this.ctx.database.get(TableName.Entity, {
            type: "member",
            parentId: channelId,
        }) as unknown as MemberEntity[];

        return members.map((member) => ({
            id: member.id,
            type: "member",
            name: member.name,
            attributes: {
                ...member.attributes,
            },
        }));
    }

    async buildEventHistory(percept: UserMessagePercept, env: Environment): Promise<Observation[]> {
        const channelId = env.id.split(":")[1];

        // 获取 L1 历史
        const rawEvents = await this.recorder.getMessages(percept.runtime?.session.cid, {}, this.config.l1_memory.maxMessages);

        // eslint-disable-next-line array-callback-return
        return rawEvents.map((item) => {
            if (item.eventType === TimelineEventType.Message) {
                return {
                    type: "message",
                    sender: {
                        type: "member",
                        id: item.eventData.senderId,
                        name: item.eventData.senderName,
                        attributes: {},
                    },
                    timestamp: item.timestamp,
                    content: item.eventData.content,
                    messageId: item.eventData.messageId,
                };
            }
        });
    }

    async buildExtensions(percept: UserMessagePercept, env: Environment): Promise<Record<string, any>> {
        // 聊天场景的扩展数据
        return {
            // 用户关系图谱
            relationships: await this.getUserRelationships(env.id),

            // 频道情感氛围
            channelMood: await this.analyzeChannelMood(env.id),
        };
    }

    // region 辅助方法

    private extractChannelInfo(percept: UserMessagePercept): { platform: string; channelId: string } {
        if (percept.type === PerceptType.UserMessage) {
            const session = percept.runtime?.session;
            return {
                platform: session.platform,
                channelId: session.channelId,
            };
        }
        // else if (percept.type === PerceptType.ChannelEvent) {
        //     return {
        //         platform: percept.payload.platform,
        //         channelId: percept.payload.channelId,
        //     };
        // }
        // else if (percept.type === PerceptType.ScheduledTask || percept.type === PerceptType.BackgroundTaskCompletion) {
        //     const payload = percept.payload;
        //     if (payload.platform && payload.channelId) {
        //         return {
        //             platform: payload.platform,
        //             channelId: payload.channelId,
        //         };
        //     }
        // }

        throw new Error(`Cannot extract channel info from percept type: ${percept.type}`);
    }

    /**
     * 获取频道信息
     */
    private async getChannelInfo(
        platform: string,
        channelId: string,
    ): Promise<{
        name?: string;
        type?: "private" | "guild";
        memberCount?: number;
        topic?: string;
        rules?: string;
    }> {
        // TODO: 从数据库或 Koishi API 获取频道信息
        return {
            name: channelId,
            type: "guild",
        };
    }

    /**
     * 获取用户关系图谱
     */
    private async getUserRelationships(envId: string): Promise<any> {
        // TODO: 实现用户关系分析
        return {};
    }

    /**
     * 分析频道情感氛围
     */
    private async analyzeChannelMood(envId: string): Promise<any> {
        // TODO: 实现频道氛围分析
        return {
            overall: "neutral",
            recentTrend: "stable",
        };
    }
    // endregion
}
