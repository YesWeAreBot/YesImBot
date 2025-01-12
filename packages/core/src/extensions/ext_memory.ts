// @ts-nocheck
import { SchemaNode } from "../adapters/creators/schema";
import { isEmpty } from "../utils";
import { Description, Extension, Name, Param } from "./base";

@Name("addCoreMemory")
@Description("Append to the contents of core memory.")
@Param("content", SchemaNode.String("Content to write to the memory. All unicode (including emojis) are supported."))
@Param("topic", SchemaNode.String("The topic of the memory."))
@Param("keywords", SchemaNode.Array("The keywords of the memory."))
export class AddCoreMemory extends Extension {
  async apply(args: { content: string; topic?: string; keywords?: string[] }) {
    const { content, topic, keywords } = args;
    if (content) throw new Error("content is required");
    return await this.ctx.memory.addCoreMemory(content, topic, keywords);
  }
}

@Name("modifyCoreMemory")
@Description("Replace the contents of core memory. To delete memories, use an empty string for newContent.")
@Param("oldContent", SchemaNode.String("The current content of the memory."))
@Param("newContent", SchemaNode.String("The new content of the memory. All unicode (including emojis) are supported."))
export class ModifyCoreMemory extends Extension {
  async apply(args: { oldContent: string; newContent: string }) {
    const { oldContent, newContent } = args;
    if (isEmpty(oldContent)) throw new Error("oldContent is required");
    if (isEmpty(newContent)) throw new Error("newContent is required");
    return await this.ctx.memory.modifyCoreMemory(oldContent, newContent);
  }
}

@Name("addUserMemory")
@Description("Append to the contents of user memory.")
@Param("userId", SchemaNode.String("The user ID of the memory."))
@Param("content", SchemaNode.String("Content to write to the memory. All unicode (including emojis) are supported."))
export class AddUserMemory extends Extension {
  async apply(args: { userId: string; content: string }) {
    const { userId, content } = args;
    if (isEmpty(userId)) throw new Error("userId is required");
    if (isEmpty(content)) throw new Error("content is required");
    return await this.ctx.memory.addUserMemory(userId, content);
  }
}

@Name("modifyUserMemory")
@Description("Replace the contents of user memory. To delete memories, use an empty string for newContent.")
@Param("userId", SchemaNode.String("The user ID of the memory."))
@Param("oldContent", SchemaNode.String("The current content of the memory."))
@Param("newContent", SchemaNode.String("The new content of the memory. All unicode (including emojis) are supported."))
export class ModifyUserMemory extends Extension {
  async apply(args: { userId: string; oldContent: string; newContent: string }) {
    const { userId, oldContent, newContent } = args;
    if (isEmpty(userId)) throw new Error("userId is required");
    if (isEmpty(oldContent)) throw new Error("oldContent is required");
    if (isEmpty(newContent)) throw new Error("newContent is required");
    return await this.ctx.memory.modifyUserMemory(userId, oldContent, newContent);
  }
}

@Name("addArchivalMemory")
@Description("Add to archival memory. Make sure to phrase the memory contents such that it can be easily queried later.")
@Param("content", "Content to write to the memory.")
@Param("type", SchemaNode.Enum("The type of memory to add.", ["核心记忆", "用户记忆", "群成员记忆", "通用知识"]))
@Param("topic", SchemaNode.String("The topic of the memory."))
@Param("keywords", SchemaNode.Array("Keywords to associate with the memory."))
export class AddArchivalMemory extends Extension {
  async apply(args: { content: string; type: MemoryType; topic: string; keywords: string[] }) {
    const { content, type, topic, keywords } = args;
    if (isEmpty(content)) throw new Error("content is required");
    if (isEmpty(type)) throw new Error("type is required");
    if (isEmpty(topic)) throw new Error("topic is required");
    if (keywords.length === 0) throw new Error("keywords is required");
    return await this.ctx.memory.addArchivalMemory(content, type, topic, keywords);
  }
}

@Name("searchArchivalMemory")
@Description("Search archival memory using semantic (embedding-based) search.")
@Param("query", SchemaNode.String("String to search for."))
@Param("type", SchemaNode.Enum("The type of memory to add.", ["核心记忆", "用户记忆", "群成员记忆", "通用知识"]))
@Param("topic", SchemaNode.String("The topic of the memory."))
@Param("keywords", SchemaNode.Array("Keywords to associate with the memory."))
@Param("limit", SchemaNode.Integer("Number of results to return. Defaults to 10.", 10))
export class SearchArchivalMemory extends Extension {
  async apply(args: { query: string; type: MemoryType; topic: string; keywords: string[]; limit?: number }) {
    const { query, type, topic, keywords, limit } = args;
    if (isEmpty(query)) throw new Error("query is required");
    if (isEmpty(type)) throw new Error("type is required");
    if (isEmpty(topic)) throw new Error("topic is required");
    if (keywords.length === 0) throw new Error("keywords is required");
    return await this.ctx.memory.searchArchivalMemory(query, type, topic, keywords, limit || 10);
  }
}

@Name("searchConversation")
@Description("Search conversation using semantic (embedding-based) search.")
@Param("query", SchemaNode.String("String to search for."))
@Param("userId", SchemaNode.String("User ID to search for."))
@Param("count", SchemaNode.Integer("Number of results to return. Defaults to 10.", 10))
export class SearchConversation extends Extension {
  async apply(args: { query: string; userId: string; count: number }) {
    const { query, userId, count } = args;
    if (isEmpty(query)) throw new Error("query is required");
    if (isEmpty(userId)) throw new Error("userId is required");
    return await this.ctx.memory.searchConversation(query, userId, count || 10);
  }
}
