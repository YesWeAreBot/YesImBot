import { Context } from "koishi";
import { z } from "zod";
import { ChatModel } from "../../adapters/chat";
import { generateObject } from "../../dependencies/xsai";
import { ChatMessage } from "../../types/model";
import { Scenario } from "./Scenario";
import { ConversationSummary, Message } from "./types";

export class ContextProcessor {
    constructor(private ctx: Context, private chatModel: ChatModel) {}

    /**
     * 分析场景中的待处理消息，并生成摘要
     */
    async analyze(scenario: Scenario): Promise<void> {
        if (!scenario.isActive) return;

        try {
            const pendingMessages = scenario.getMessages(true).slice(-20); // 分析最近的20条消息
            const contextText = this.formatMessagesForAnalysis(pendingMessages);
            const systemPrompt = this.getSystemPrompt();

            const { provider, model } = this.chatModel.metadata;

            const { object, text } = await generateObject({
                ...provider.chat(model.ModelID),
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: contextText },
                ],
                schema: z.object({
                    overallSummary: z.string().describe("A brief, one-sentence summary of the entire conversation."),
                    activeTopics: z.array(
                        z.object({
                            topic: z.string().describe("A short, descriptive title for the topic (e.g., 'Planning Weekend Trip')."),
                            summary: z.string().describe("A detailed summary of what was discussed in this topic."),
                            participants: z.array(
                                z.object({
                                    id: z.string().describe("user_id"),
                                    name: z.string().describe("user_name"),
                                })
                            ),
                        })
                    ),
                }),
            });

            let summary: ConversationSummary;

            if (!object) {
                summary = this.parseResponse(text);
            } else {
                summary = object as ConversationSummary;
            }

            scenario.summary = summary;

            this.ctx.logger.debug(`[ContextProcessor] Scenario ${scenario.id} summary generated.`);
        } catch (error) {
            this.ctx.logger.warn(`[ContextProcessor] Failed to analyze scenario ${scenario.id}: ${error.message}`);
            scenario.summary = null;
        }
    }

    private formatMessagesForAnalysis(messages: Message[]): string {
        return messages
            .map((msg) => {
                if ("functionName" in msg) return null; // 暂时忽略交互
                const chatMsg = msg as ChatMessage;
                const sender = `${chatMsg.sender.name || chatMsg.sender.id}`;
                return `[${sender}]: ${chatMsg.content}`;
            })
            .filter(Boolean)
            .join("\n");
    }

    private getSystemPrompt(): string {
        const schema: ConversationSummary = {
            overallSummary: "A brief, one-sentence summary of the entire conversation.",
            activeTopics: [
                {
                    topic: "A short, descriptive title for the topic (e.g., 'Planning Weekend Trip').",
                    summary: "A detailed summary of what was discussed in this topic.",
                    participants: [{ id: "user_id", name: "user_name" }],
                },
            ],
        };

        return `You are an expert conversation analyst. Your task is to analyze a raw chat log from a group chat and provide a structured summary in JSON format.

        **Instructions:**
        1. Read the entire conversation provided by the user.
        2. Identify the main topics of discussion. A topic can involve two or more people.
        3. For each topic, create a summary and list the main participants (name and ID).
        4. Provide an overall summary of the new messages.
        5. If there are no clear topics, return an empty array for "activeTopics".

        **Output Format:**
        You MUST respond with a single valid JSON object. Do not add any text before or after the JSON. The JSON object must conform to the following schema:

        \`\`\`json
        ${JSON.stringify(schema, null, 2)}
        \`\`\``;
    }

    private parseResponse(content: string): ConversationSummary | null {
        try {
            // 清理LLM可能返回的markdown代码块
            const jsonString = content.replace(/```json\n|```/g, "").trim();
            return JSON.parse(jsonString) as ConversationSummary;
        } catch (error) {
            this.ctx.logger.warn(`[ContextProcessor] Failed to parse LLM response: ${content}`);
            return null;
        }
    }
}
