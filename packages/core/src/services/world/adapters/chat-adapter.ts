import type { Session } from "koishi";
import type { AnyStimulus, Entity, Environment, Event, UserMessageStimulus } from "@/services/world/types";

import { StimulusSource } from "@/services/world/types";
import { TableName } from "@/shared/constants";
import { SceneAdapter } from "./base";

/**
 * 聊天场景适配器
 *
 * 将聊天场景的数据（频道、用户、消息）转换为通用的 WorldState 抽象
 */
export class ChatSceneAdapter extends SceneAdapter {
    name = "chat";

    public canHandle(stimulus: AnyStimulus): boolean {
        return stimulus.type === StimulusSource.UserMessage;
    }

    async buildEnvironment(stimulus: UserMessageStimulus): Promise<Environment> {
        const { platform, channelId } = this.extractChannelInfo(stimulus);

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

    async buildEntities(stimulus: UserMessageStimulus, env: Environment): Promise<Entity[]> {
        const channelId = env.id;

        // 从数据库获取成员列表
        const members = await this.ctx.database.get(TableName.Members, {
            guildId: channelId.split(":")[1],
        });

        return members.map(member => ({
            type: "user",
            id: member.pid,
            name: member.name,
            attributes: {
                roles: member.roles || [],
                joinedAt: member.joinedAt,
                lastActive: member.lastActive,
                // 聊天场景特定的属性
                avatar: member.avatar,
                platform: member.platform,
            },
        }));
    }

    async buildEventHistory(stimulus: UserMessageStimulus, env: Environment): Promise<Event[]> {
        const channelId = env.id.split(":")[1];

        // 获取 L1 历史
        const rawEvents = await this.history.getL1History(channelId, { limit: 50 });

        return rawEvents.map((item) => {
            if (item.type === "message") {
                return {
                    type: "chat_message",
                    timestamp: item.timestamp,
                    actor: {
                        type: "user",
                        id: item.sender.id,
                        name: item.sender.name,
                        attributes: {},
                    },
                    payload: {
                        content: item.content,
                        messageId: item.id,
                        elements: item.elements,
                    },
                };
            }
            else if (item.type === "channel_event") {
                return {
                    type: "chat_event",
                    timestamp: item.timestamp,
                    payload: {
                        eventType: item.eventType,
                        ...item.data,
                    },
                };
            }
            else if (item.type === "agent_response") {
                return {
                    type: "agent_action",
                    timestamp: item.timestamp,
                    actor: {
                        type: "agent",
                        id: "self",
                        name: "Athena",
                        attributes: {},
                    },
                    payload: {
                        actions: item.actions,
                        thoughts: item.thoughts,
                    },
                };
            }
        });
    }

    async buildExtensions(stimulus: UserMessageStimulus, env: Environment): Promise<Record<string, any>> {
        // 聊天场景的扩展数据
        return {
            // 用户关系图谱
            relationships: await this.getUserRelationships(env.id),

            // 频道情感氛围
            channelMood: await this.analyzeChannelMood(env.id),
        };
    }

    // region 辅助方法

    private extractChannelInfo(stimulus: UserMessageStimulus): { platform: string; channelId: string } {
        if (stimulus.type === StimulusSource.UserMessage) {
            const session = stimulus.payload as Session;
            return {
                platform: session.platform,
                channelId: session.channelId,
            };
        }
        else if (stimulus.type === StimulusSource.ChannelEvent) {
            return {
                platform: stimulus.payload.platform,
                channelId: stimulus.payload.channelId,
            };
        }
        else if (stimulus.type === StimulusSource.ScheduledTask || stimulus.type === StimulusSource.BackgroundTaskCompletion) {
            const payload = stimulus.payload;
            if (payload.platform && payload.channelId) {
                return {
                    platform: payload.platform,
                    channelId: payload.channelId,
                };
            }
        }

        throw new Error(`Cannot extract channel info from stimulus type: ${stimulus.type}`);
    }

    /**
     * 获取频道信息
     */
    private async getChannelInfo(platform: string, channelId: string): Promise<{
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
