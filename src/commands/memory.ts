import { Context } from "koishi";
import { Bot } from "../bot";

export function apply(ctx: Context, bot: Bot) {
  ctx
    .command("memory.add <content:string> [userId:string]", "添加记忆")
    .option("content", "-c <content:string>; 记忆内容")
    .option("userId", "-u <userId:string>; 用户ID")
    .action(async ({ session, command, options }, content, userId) => {
      if (!content) {
        return session.send(`请输入记忆内容`);
      }
      await bot.memory.addText(content, userId);
      await session.send(`记忆添加成功`);
    });

  ctx
    .command("memory.search <query:string> [limit:number]", "搜索记忆")
    .option("query", "-q <query>; 查询关键词")
    .option("limit", "-l <limit:number>; 查询数量")
    .action(async ({ session, command, options }, query, limit) => {
      const results = await bot.memory.search(query, limit);
      if (results.length === 0) {
        await session.send(`没有找到与 ${query} 相关的记忆`);
      } else {
        await session.send(`找到 ${results.length} 条与 ${query} 相关的记忆:\n${results.join("\n")}`);
      }
    });

  ctx
    .command("memory.get <userId:string>", "获取用户记忆")
    .action(async ({ session, command, options }, userId) => {
      const memory = await bot.memory.getUserMemory(userId);
      if (memory.length === 0) {
        await session.send(`没有找到与 ${userId} 相关的记忆`);
      } else {
        await session.send(`找到 ${memory.length} 条与 ${userId} 相关的记忆:\n${memory.join("\n")}`);
      }
  })

  ctx
    .command("memory.delete <userId>", "删除用户记忆")
    .action(async ({ session, command, options }, userId) => {

    })

  ctx
    .command("memory.clear", "清空所有记忆")
    .action(async ({ session, command, options }) => {
      //await bot.memory.clear();
    })
}
