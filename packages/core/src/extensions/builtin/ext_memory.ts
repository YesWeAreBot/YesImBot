import { z } from "zod";

import { Memory } from "../../Memory";
import { MESSAGE_TABLE } from "../../types/model";
import { formatDate } from "../../utils";
import { isEmpty } from "../../utils/string";
import { Failed, INNER_THOUGHTS, REQUEST_HEARTBEAT, Success, Tool } from "../base";


export const AppendCoreMemory = Tool({
    name: "core_memory_append",
    description: "Append to the contents of core memory.",
    parameters: z.object({
        inner_thoughts: INNER_THOUGHTS,
        label: z.string().describe("Section of the memory to be edited (persona or human)."),
        content: z.string().describe("Content to write to the memory."),
        request_heartbeat: REQUEST_HEARTBEAT,
    }),
    execute: async ({ label, content }, context) => {
        if (isEmpty(content)) throw new Error("content is required");
        const memory = Memory.instance;
        if (memory) {
            let result = await memory.appendCoreMemory(label, content);
            return Success(result);
        } else {
            return Failed("Memory is not initialized.");
        }
    }
})

export const ReplaceCoreMemory = Tool({
    name: "core_memory_replace",
    description: "Replace the contents of core memory.",
    parameters: z.object({
        inner_thoughts: INNER_THOUGHTS,
        label: z.string().describe("Section of the memory to be edited (persona or human)."),
        old_content: z.string().describe("String to replace. Must be an exact match."),
        new_content: z.string().describe("Content to write to the memory. To delete memories, use an empty string."),
        request_heartbeat: REQUEST_HEARTBEAT,
    }),
    execute: async ({ label, old_content, new_content }, context) => {
        if (isEmpty(old_content)) throw new Error("old_content is required");
        const memory = Memory.instance;
        if (memory) {
            let result = await memory.replaceCoreMemory(label, old_content, new_content);
            return Success(result);
        } else {
            return Failed("Memory is not initialized.");
        }
    }
})

export const SearchConversation = Tool({
    name: "conversation_search",
    description: "Search prior conversation history using case-insensitive string matching.",
    parameters: z.object({
        inner_thoughts: INNER_THOUGHTS,
        query: z.string().describe("String to search for."),
        page: z.number().optional().describe("Allows you to page through results. Only use on a follow-up query. Defaults to 0 (first page)."),
        request_heartbeat: REQUEST_HEARTBEAT,
    }),
    execute: async ({ query, page }, context) => {
        const channel_id = context.session?.channelId;

        const messages = await context.ctx.database.get(MESSAGE_TABLE, {
            channel: {
                id: channel_id
            },
            content: { $regex: query },
        });
        if (messages.length === 0) {
            return Failed("No messages found.");
        }
        let result = [
            `Found ${messages.length} messages:`,
            ...messages.map(message => `[${formatDate(message.timestamp)} ${message.sender.name}<${message.sender.id}>] ${message.content}`)
        ].join("\n");
        return Success(result);
    }
})

export const SearchConversationWithDate = Tool({
    name: "conversation_search_date",
    description: "Search prior conversation history using a date range.",
    parameters: z.object({
        inner_thoughts: INNER_THOUGHTS,
        start_date: z.string().describe("The start of the date range to search, in the format 'YYYY-MM-DD HH:mm:ss'."),
        end_date: z.string().describe("The end of the date range to search, in the format 'YYYY-MM-DD HH:mm:ss'."),
        page: z.number().optional().describe("Allows you to page through results. Only use on a follow-up query. Defaults to 0 (first page)."),
        request_heartbeat: REQUEST_HEARTBEAT,
    }),
    execute: async ({ start_date, end_date, page }, context) => {
        const channel_id = context.session?.channelId;

        const start = new Date(start_date);
        const end = new Date(end_date);

        const messages = await context.ctx.database.get(MESSAGE_TABLE, {
            channel: {
                id: channel_id
            },
            timestamp: { $gte: start, $lte: end },
        });

        if (messages.length === 0) {
            return Failed("No messages found in the specified date range.");
        }
        let result = [
            "Found ${messages.length} messages in the specified date range:",
            ...messages.map(message => `[${formatDate(message.timestamp)} ${message.sender.name}<${message.sender.id}>] ${message.content}`)
        ].join("\n");
        return Success(result);
    }
})

export const InsertArchivalMemory = Tool({
    name: "archival_memory_insert",
    description: "Add to archival memory. Make sure to phrase the memory contents such that it can be easily queried later.",
    parameters: z.object({
        inner_thoughts: INNER_THOUGHTS,
        content: z.string().describe("Content to write to the memory."),
        request_heartbeat: REQUEST_HEARTBEAT,
    }),
    execute: async ({ content }, context) => {
        if (isEmpty(content)) throw new Error("content is required");
        const memory = Memory.instance;
        if (memory) {
            let result = await memory.insertArchivalMemory(content);
            return Success(result);
        } else {
            return Failed("Memory is not initialized.");
        }
    }
})

export const SearchArchivalMemory = Tool({
    name: "archival_memory_search",
    description: "Search archival memory using semantic (embedding-based) search.",
    parameters: z.object({
        inner_thoughts: INNER_THOUGHTS,
        query: z.string().describe("String to search for."),
        page: z.number().optional().describe("Allows you to page through results. Only use on a follow-up query. Defaults to 0 (first page)."),
        start: z.number().optional().describe(" Starting index for the search results. Defaults to 0."),
        request_heartbeat: REQUEST_HEARTBEAT,
    }),
    execute: async ({ query, page, start }, context) => {
        const memory = Memory.instance;
        if (memory) {
            let result = await memory.searchArchivalMemory(query, page, start);
            return Success(result);
        } else {
            return Failed("Memory is not initialized.");
        }
    }
})