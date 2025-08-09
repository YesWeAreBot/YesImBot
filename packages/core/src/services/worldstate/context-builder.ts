import { Channel, Context, Logger } from "koishi";

import { Services, TableName } from "@/shared/constants";
import { HistoryConfig } from "./config";
import { SemanticMemoryManager } from "./l2-semantic-memory";
import { ArchivalMemoryManager } from "./l3-archival-memory";
import { DiaryEntryData, InteractionData, InteractionTurn, RetrievedMemoryChunk, WorldState } from "./types";

export class ContextBuilder {
    private logger: Logger;

    constructor(
        private ctx: Context,
        private config: HistoryConfig,
        private l2Manager: SemanticMemoryManager,
        private l3Manager: ArchivalMemoryManager
    ) {
        this.logger = ctx[Services.Logger].getLogger("[上下文构建器]");
    }

    public async build(platform: string, channelId: string): Promise<WorldState> {
        const bot = this.ctx.bots.find((b) => b.platform === platform && b.isActive);
        let channel: {
            id: string;
            name?: string;
            type: number;
        };

        if (!bot) {
            this.logger.warn(`找不到平台 ${platform} 的在线机器人`);
            channel = {
                id: channelId,
                name: "未知频道",
                type: 0,
            };
        } else {
            channel = await bot.getChannel(channelId);
        }

        // 1. L1 - Working Memory
        const l1_working_memory = await this.buildL1Memory(platform, channelId);

        // 2. L2 - Semantic Search
        let l2_retrieved_memories: RetrievedMemoryChunk[] = [];
        if (this.config.l2_memory.enabled && l1_working_memory.pending_turn?.dialogue.length > 0) {
            const lastMessage = l1_working_memory.pending_turn.dialogue.slice(-1)[0].content;
            const retrieved = await this.l2Manager.search(lastMessage, this.config.l2_memory.retrievalK);
            l2_retrieved_memories = retrieved.map((chunk) => ({
                content: chunk.content,
                relevance: 0, // Placeholder for actual relevance score
                timestamp: chunk.startTimestamp,
            }));
        }

        // 3. L3 - Diary
        let l3_diary_entries: DiaryEntryData[] = [];
        if (this.config.l3_memory.enabled) {
            // Example: retrieve yesterday's diary
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const dateStr = yesterday.toISOString().split("T")[0];
            const diary = await this.ctx.database.get("worldstate.l3_diaries", { channelId, date: dateStr });
            l3_diary_entries = diary;
        }

        const worldState: WorldState = {
            channel: {
                id: channel.id,
                name: channel.name,
                type: channel.type === 0 ? "private" : "guild",
                platform: platform,
            },
            current_time: new Date().toISOString(),
            self: {
                id: bot.selfId,
                name: bot.user.name,
            },
            l1_working_memory,
            l2_retrieved_memories,
            l3_diary_entries,
            users: [], // User profile can be another service
        };

        return worldState;
    }

    private async buildL1Memory(platform: string, channelId: string): Promise<WorldState["l1_working_memory"]> {
        const pendingTurnData = await this.ctx.database.get(
            TableName.Interactions,
            { platform, channelId, status: "pending" },
            { limit: 1, sort: { startTimestamp: "desc" } }
        );
        const processedTurnsData = await this.ctx.database.get(
            TableName.Interactions,
            { platform, channelId, status: "processed" },
            { limit: 10, sort: { startTimestamp: "desc" } }
        );

        const pending_turn = pendingTurnData.length > 0 ? await this.hydrateTurn(pendingTurnData[0]) : undefined;
        const processed_turns = await Promise.all(processedTurnsData.map((t) => this.hydrateTurn(t)));

        // Apply graceful degradation
        this.applyGracefulDegradation(processed_turns);

        return {
            pending_turn,
            processed_turns,
        };
    }

    private async hydrateTurn(turnData: InteractionData): Promise<InteractionTurn> {
        const messages = await this.ctx.database.get(TableName.Messages, { interactionId: turnData.id });
        const agentTurn = await this.ctx.database.get(TableName.AgentTurns, { interactionId: turnData.id }).then((res) => res[0]);

        return {
            id: turnData.id,
            status: turnData.status,
            startTimestamp: turnData.startTimestamp,
            endTimestamp: turnData.endTimestamp,
            dialogue: messages.map((m) => ({
                id: m.id,
                sender: m.sender,
                content: m.content,
                elements: [], // h.parse(m.content),
                timestamp: m.timestamp,
                quoteId: m.quoteId,
            })),
            systemEvents: [], // System events can be hydrated similarly
            agentTurn: agentTurn
                ? {
                      thoughts: agentTurn.thoughts,
                      actions: agentTurn.actions,
                      observations: agentTurn.observations,
                  }
                : undefined,
        };
    }

    private applyGracefulDegradation(turns: InteractionTurn[]): void {
        const { keepFullTurnCount, keepThoughtsOnlyCount } = this.config.l1_memory.gracefulDegradation;

        for (let i = 0; i < turns.length; i++) {
            const turn = turns[i];
            if (!turn.agentTurn) continue;

            if (i >= keepFullTurnCount) {
                turn.agentTurn.observations = undefined;
                turn.agentTurn.actions = undefined;
            }
            if (i >= keepThoughtsOnlyCount) {
                turn.agentTurn = undefined;
            }
        }
    }
}
