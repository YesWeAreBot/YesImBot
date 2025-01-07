export interface MemoryItem {
  id: string;          // 全局唯一 ID
  embedding: number[]; // 向量表示，用于语义检索
  magnitude?: number;  // 向量表示的模
  content: string;     // 记忆内容
  type: MemoryType;    // 记忆类型
  topic: string;       // 主题，用于分类
  keywords: string[];  // 关键词，用于辅助查询

  createdAt: Date;   // 创建时间
  updatedAt: Date;   // 更新时间
}

export enum MemoryType {
  Core = "核心记忆",
  User = "用户记忆",
  Group = "群成员记忆",
  Knowledge = "通用知识",
}

export interface CoreMemory extends MemoryItem {
  type: MemoryType.Core;
}

export interface UserMemory extends MemoryItem {
  type: MemoryType.User;
  userId: string;
}
