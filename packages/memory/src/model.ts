export interface MemoryItem {
  id: string;          // 全局唯一 ID
  embedding: number[]; // 向量表示，用于语义检索
  magnitude?: number;  // 向量表示的模
  content: string;     // 记忆内容
  topic: string;       // 主题，用于分类
  keywords: string[];  // 关键词，用于辅助查询
}

// 主题设计
//   用户相关：
//     用户兴趣
//     用户发言风格
//     用户常用术语
//   群聊内容：
//     最近讨论
//     热门话题
//   系统相关：
//     LLM 设定
//     特定领域知识

// 关键词设计方式
//   用户相关：
//     用户名（如“用户A”）
//     兴趣领域（如“FPS游戏”“冒险游戏”）
//     特殊标签（如“高活跃”“低活跃”）
//   内容相关：
//     讨论话题关键词（如“游戏”“技术问题”）
//     特定领域的知识标签（如“编程语言”“机器学习”）

export interface GuildMemory {
  guildId: string;           // 群聊唯一 ID
  guildName: string;         // 群聊名称
  guildDescription?: string; // 群聊描述
  members: MemberInfo[];  // 成员信息列表
  recentTopics: string[]; // 最近讨论主题
}

export interface MemberInfo {
  userId: string;   // 用户唯一 ID
  userNick: string; // 用户在该群的昵称
  role: string;     // 用户角色（如管理员、成员）
}

export interface UserMemory {
  userId: string;        // 用户唯一 ID
  userName: string;      // 用户全局名称
  preferences: string[]; // 用户兴趣偏好
  groupSpecific: GroupActivity[]; // 与群聊相关的活动
}

export interface GroupActivity {
  guildId: string;   // 群聊唯一 ID
  userNick: string;  // 用户在该群的昵称
  role: string;      // 用户在该群的角色
  actions: string[]; // 用户的活动记录
}

