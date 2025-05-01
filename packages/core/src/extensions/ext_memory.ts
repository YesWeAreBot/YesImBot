import { z } from "zod";

import { Memory } from "../Memory";
import { Agent } from "../agent";
import { formatDate } from "../utils";
import { isEmpty } from "../utils/string";
import { Tool } from "./base";

export const AppendCoreMemory = Tool({
    name: "core_memory_append",
    description: "Append to the contents of core memory.",
    parameters: z.object({
        inner_thought: z.string().describe("The inner thought of the memory."),
        label: z.string().describe("Section of the memory to be edited (persona or human)."),
        content: z.string().describe("Content to write to the memory."),
        request_heartbeat: z.boolean().optional().describe("Request an immediate heartbeat after function execution. Set to `true` if you want to send a follow-up message or run a follow-up function.")
    }),
    execute: async ({ inner_thought, label, content, request_heartbeat }, context) => {
        if (isEmpty(content)) throw new Error("content is required");
        const memory = Memory.instance;
        if (memory) {
            return await memory.appendCoreMemory(label, content);
        } else {
            throw new Error("Memory is not initialized.")
        }
    }
})

export const ReplaceCoreMemory = Tool({
    name: "core_memory_replace",
    description: "Replace the contents of core memory.",
    parameters: z.object({
        inner_thought: z.string().describe("The inner thought of the memory."),
        label: z.string().describe("Section of the memory to be edited (persona or human)."),
        old_content: z.string().describe("String to replace. Must be an exact match."),
        new_content: z.string().describe("Content to write to the memory. To delete memories, use an empty string."),
        request_heartbeat: z.boolean().optional().describe("Request an immediate heartbeat after function execution. Set to `true` if you want to send a follow-up message or run a follow-up function.")
    }),
    execute: async ({ inner_thought, label, old_content, new_content, request_heartbeat }, context) => {
        if (isEmpty(old_content)) throw new Error("old_content is required");
        const memory = Memory.instance;
        if (memory) {
            return await memory.replaceCoreMemory(label, old_content, new_content);
        } else {
            throw new Error("Memory is not initialized.")
        }
    }
})

export const SearchConversation = Tool({
    name: "conversation_search",
    description: "Search prior conversation history using case-insensitive string matching.",
    parameters: z.object({
        inner_thoughts: z.string().describe("The inner thoughts of the conversation."),
        query: z.string().describe("String to search for."),
        page: z.number().optional().describe("Allows you to page through results. Only use on a follow-up query. Defaults to 0 (first page)."),
        request_heartbeat: z.boolean().optional().describe("Request an immediate heartbeat after function execution. Set to `true` if you want to send a follow-up message or run a follow-up function.")
    }),
    execute: async ({ inner_thoughts, query, page, request_heartbeat }, context) => {
        const channel_id = context.session?.channelId;

        const messages = await context.ctx.database.get(Agent.MESSAGE_TABLE, {
            channel: {
                id: channel_id
            },
            content: { $regex: query },
        });
        if (messages.length === 0) {
            return "No messages found.";
        }
        let result = [
            `Found ${messages.length} messages:`,
            "",
            ...messages.map(message => `[${formatDate(message.timestamp)} ${message.sender.name}<${message.sender.id}>] ${message.content}`)
        ].join("\n");

        return result
    }
})

export const SearchConversationWithDate = Tool({
    name: "conversation_search_date",
    description: "Search prior conversation history using a date range.",
    parameters: z.object({
        inner_thoughts: z.string().describe("The inner thoughts of the conversation."),
        start_date: z.string().describe("The start of the date range to search, in the format 'YYYY-MM-DD HH:mm:ss'."),
        end_date: z.string().describe("The end of the date range to search, in the format 'YYYY-MM-DD HH:mm:ss'."),
        page: z.number().optional().describe("Allows you to page through results. Only use on a follow-up query. Defaults to 0 (first page)."),
        request_heartbeat: z.boolean().optional().describe("Request an immediate heartbeat after function execution. Set to `true` if you want to send a follow-up message or run a follow-up function.")
    }),
    execute: async ({ inner_thoughts, start_date, end_date, page, request_heartbeat }, context) => {
        const channel_id = context.session?.channelId;

        const start = new Date(start_date);
        const end = new Date(end_date);

        const messages = await context.ctx.database.get("yesimbot.agent.message", {
            channel: {
                id: channel_id
            },
            timestamp: { $gte: start, $lte: end },
        });

        if (messages.length === 0) {
            return "No messages found in the specified date range.";
        }
        let result = "";
        for (const message of messages) {
            result += `[${new Date(message.timestamp).toISOString()} ${message.sender}] ${message.content}\n`;
        }

        return `Found ${messages.length} messages in the specified date range:\n${result}`
    }
})