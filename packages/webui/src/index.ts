import { } from "@koishijs/plugin-console";
import { Context } from "koishi";
import { MemoryItem, MemoryType } from "koishi-plugin-yesimbot-memory";
import { resolve } from "path";

import { Config } from "./config";

export const name = "yesimbot-webui";

export const inject = {
  required: ["database", "console", "memory"],
};

export { Config } from "./config";

declare module "@koishijs/plugin-console" {
  interface Events {
    "memory/get": (memoryId: string) => MemoryItem;
    "memory/getAll": () => MemoryItem[];
    "memory/delete": (memoryId: string) => boolean;
    "memory/clear": () => void;
    "memory/modifyMemoryById": (memoryId: string, content: string, type?: MemoryType, topic?: string, keywords?: string[]) => Promise<void>;
    "memory/addCoreMemory": (content: string, topic?: string, keywords?: string[]) => Promise<string>;
    "memory/modifyCoreMemory": (oldContent: string, newContent: string) => Promise<void>;
    "memory/addUserMemory": (userId: string, content: string) => Promise<void>;
    "memory/modifyUserMemory": (userId: string, oldContent: string, newContent: string) => Promise<void>;
    "memory/addArchivalMemory": (content: string, type: MemoryType, topic: string, kerwords: string[]) => Promise<void>;
    "memory/searchArchivalMemory": (query: string, type: MemoryType, topic: string, kerwords: string[], count?: number) => Promise<string[]>;
    "memory/searchConversation": (query: string, userId: string, count?: number) => Promise<string[]>;
  }
}

export function apply(ctx: Context, config: Config) {
  ctx.inject(["console"], (ctx) => {
    ctx.console.addEntry({
      dev: resolve(__dirname, "../client/index.ts"),
      prod: resolve(__dirname, "../dist"),
    });
  });

  ctx.console.addListener("memory/get", (memoryId) => {
    ctx.logger.info("memory/get", memoryId);
    return ctx.memory.get(memoryId);
  });

  ctx.console.addListener('memory/getAll', () => {
    ctx.logger.info("memory/getAll");
    return ctx.memory.getAll()
  })

  ctx.console.addListener("memory/delete", (memoryId) => {
    ctx.logger.info("memory/delete", memoryId);
    return ctx.memory.delete(memoryId);
  });

  ctx.console.addListener("memory/clear", () => {
    ctx.logger.info("memory/clear");
    return ctx.memory.clear();
  });

  ctx.console.addListener("memory/modifyMemoryById", async (memoryId, content, type, topic, keywords)=>{
    ctx.logger.info("memory/modifyMemoryById", memoryId, content, type, topic, keywords)
    return await ctx.memory.modifyMemoryById(memoryId, content, type, topic, keywords)
  })

  ctx.console.addListener('memory/addCoreMemory', async (content, topic, kerwords) => {
    ctx.logger.info("memory/addCoreMemory", content, topic, kerwords)
    return await ctx.memory.addCoreMemory(content, topic, kerwords)
  })

  ctx.console.addListener('memory/modifyCoreMemory', async (oldContent, newContent) => {
    ctx.logger.info("memory/modifyCoreMemory", oldContent, newContent)
    return await ctx.memory.modifyCoreMemory(oldContent, newContent)
  })

  ctx.console.addListener("memory/addUserMemory", async (userId, content) => {
    ctx.logger.info("memory/addUserMemory", userId, content)
    return await ctx.memory.addUserMemory(userId, content)
  })

  ctx.console.addListener("memory/modifyUserMemory", async (userId, oldContent, newContent) => {
    ctx.logger.info("memory/modifyUserMemory", userId, oldContent, newContent)
    return await ctx.memory.modifyUserMemory(userId, oldContent, newContent)
  })

  ctx.console.addListener("memory/addArchivalMemory", async (content, type, topic, kerwords) => {
    ctx.logger.info("memory/addArchivalMemory", content)
    return await ctx.memory.addArchivalMemory(content, type, topic, kerwords)
  })

  ctx.console.addListener("memory/searchArchivalMemory", async (query, type, topic, kerwords, count) => {
    ctx.logger.info("memory/searchArchivalMemory", query, type, topic, kerwords, count)
    return await ctx.memory.searchArchivalMemory(query, type, topic, kerwords, count)
  })
}
