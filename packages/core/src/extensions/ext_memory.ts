// @ts-nocheck
import { SchemaNode } from "../adapters/creators/schema";
import { Description, Extension, Name, Param } from "./base";

@Name("addCoreMemory")
@Description("Append to the contents of core memory.")
@Param("content", SchemaNode.String("Content to write to the memory. All unicode (including emojis) are supported."))
@Param("topic", SchemaNode.String("The topic of the memory.", ""))
@Param("keywords", SchemaNode.Array("The keywords of the memory.", ""))
export class AddCoreMemory extends Extension {
  async apply(content: string, topic?: string, keywords?: string[]) {
    return await this.ctx.memory.addCoreMemory(content, topic, keywords);
  }
}

@Name("modifyCoreMemory")
@Description("Replace the contents of core memory. To delete memories, use an empty string for newContent.")
@Param("oldContent", SchemaNode.String("The current content of the memory."))
@Param("newContent", SchemaNode.String("The new content of the memory. All unicode (including emojis) are supported."))
export class ModifyCoreMemory extends Extension {
  async apply(oldContent: string, newContent: string) {
   return await this.ctx.memory.modifyCoreMemory(oldContent, newContent);
  }
}

@Name("addUserMemory")
@Description("Append to the contents of user memory.")
@Param("userId", SchemaNode.String("The user ID of the memory."))
@Param("content", SchemaNode.String("Content to write to the memory. All unicode (including emojis) are supported."))
export class AddUserMemory extends Extension {
  async apply(userId: string, content: string) {
   return await this.ctx.memory.addUserMemory(userId, content);
  }
}

@Name("modifyUserMemory")
@Description("Replace the contents of user memory. To delete memories, use an empty string for newContent.")
@Param("userId", SchemaNode.String("The user ID of the memory."))
@Param("oldContent", SchemaNode.String("The current content of the memory."))
@Param("newContent", SchemaNode.String("The new content of the memory. All unicode (including emojis) are supported."))
export class ModifyUserMemory extends Extension {
  async apply(userId: string, oldContent: string, newContent: string) {
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
  async apply(content: string, type: MemoryType, topic: string, keywords: string[]) {
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
  async apply(query: string, type: MemoryType, topic: string, keywords: string[], limit: number = 10) {
    const options = {
      type,
      topic,
      keywords,
      limit,
    };
    return await this.ctx.memory.searchArchivalMemory(query, options);
  }
}

@Name("searchConversation")
@Description("Search conversation using semantic (embedding-based) search.")
@Param("query", SchemaNode.String("String to search for."))
@Param("userId", SchemaNode.String("User ID to search for."))
@Param("count", SchemaNode.Integer("Number of results to return. Defaults to 10.", 10))
export class SearchConversation extends Extension {
  async apply(query: string, userId: string, count: number = 10) {
    return await this.ctx.memory.searchConversation(query, userId, count);
  }
}
