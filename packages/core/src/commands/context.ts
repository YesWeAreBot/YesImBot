import { Context } from "koishi";

import { MESSAGE_TABLE } from "../types/model";
import { isEmpty } from "../utils/string";
import { getChannelType } from "../utils";  

export const name = "yesimbot.command.memory";

export function apply(ctx: Context) {
    ctx.command("添加消息 <content:text>", "在指定场景末尾添加系统消息", { authority: 3 })  
        .option("channel", "-c <channel:string> 指定要添加消息的频道ID，不填默认为当前频道")  
        .option("sender", "-s <sender:string> 指定发送者名称，默认为 'SYSTEM'")  
        .usage("向指定场景添加一条系统消息，该消息会出现在对话历史中。")  
        .example([  
            "添加消息 这是一条系统消息",  
            "添加消息 -c 123456789 系统通知：维护完成",  
            "添加消息 -s ADMIN -c 123456789 管理员消息"  
        ].join("\n"))  
        .action(async ({ session, options }, content) => {  
            if (isEmpty(content)) {  
                return "❌ 请提供要添加的消息内容";  
            }  
  
            const targetChannelId = options.channel || session.channelId;  
            const senderName = options.sender || "SYSTEM";  
              
            try {  
                // 生成唯一的消息ID  
                const messageId = `system_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;  
                  
                // 创建系统消息记录  
                await ctx.database.create(MESSAGE_TABLE, {  
                    messageId: messageId,  
                    sender: {  
                        id: "system",  
                        name: senderName,  
                        nick: senderName,  
                    },  
                    channel: {  
                        id: targetChannelId,  
                        type: getChannelType(targetChannelId),  
                    },  
                    timestamp: new Date(),  
                    content: content,  
                });  
  
                ctx.logger.info(`System message added to channel ${targetChannelId}: ${content}`);  
                  
                return `✅ 系统消息已添加到场景 ${targetChannelId}  
内容：${content}  
发送者：${senderName}`;  
                  
            } catch (error) {  
                ctx.logger.error('添加系统消息失败:', error);  
                return `❌ 添加系统消息失败：${error.message}`;  
            }  
        });  


    ctx.command("清空对话", "清除 BOT 的对话上下文", { authority: 3 })
        .option(
            "target",
            "-t <target:string> 指定要清空对话的会话。使用 private:指定私聊会话，使用 all 或 private:all 分别清除所有群聊或私聊记忆",
            { authority: 3 }
        )
        .option("person", "-p <person:string> 从所有会话中清除指定用户的记忆", { authority: 3 })
        .usage("注意：如果使用 清空对话 <target> 来清空对话而不带 -t 参数，将会清除当前会话的记忆！")
        .example(
            [
                "清空对话",
                "清空对话 -t private:1234567890",
                "清空对话 -t 987654321",
                "清空对话 -t all",
                "清空对话 -t private:all",
                "清空对话 -p 1234567890",
            ].join("\n")
        )
        .action(async ({ session, options }) => {
            const msgDestination = session.guildId || session.channelId;
            let result = "";

            if (options.person) {
                // 按用户ID清空对话
                const cleared = await clearBySenderId(ctx, options.person);
                result = `${cleared ? "✅" : "❌"} 用户 ${options.person}`;
                ctx.emit("scenario/clear", `private:${options.person}`);
            } else {
                const clearGroupId = options.target || msgDestination;
                // 要清除的会话集合
                const targetGroups = clearGroupId
                    .split(",")
                    .map((g) => g.trim())
                    .filter(Boolean);

                const messages = [];

                if (targetGroups.includes("private:all")) {
                    const success = await clearPrivateAll(ctx);
                    messages.push(`${success ? "✅" : "❌"} 全部私聊会话`);
                }

                if (targetGroups.includes("all")) {
                    const success = await clearAll(ctx);
                    messages.push(`${success ? "✅" : "❌"} 全部群组会话`);
                }

                for (const id of targetGroups) {
                    if (id === "all" || id === "private:all") continue;
                    const success = await clearChannel(ctx, id);
                    messages.push(`${success ? "✅" : "❌"} ${id}`);
                }

                result = messages.join("\n");
            }
            if (isEmpty(result)) return;
            await session.sendQueued(result);
            return;
        });

    ctx.command("压缩记忆 <label:string>", "压缩记忆上下文", { authority: 3 }).action(async ({ session }, label) => {
        if (isEmpty(label)) {
            return "请指定一个 label";
        } else {
            await ctx["yesimbot.memory"].compression(label);
            return "压缩完成";
        }
    });
}

async function clearBySenderId(ctx: Context, senderId: string): Promise<boolean> {
    const result = await ctx.database.remove(MESSAGE_TABLE, { "sender.id": senderId });
    return result.removed > 0;
}

async function clearPrivateAll(ctx: Context): Promise<boolean> {
    const result = await ctx.database.remove(MESSAGE_TABLE, { "channel.type": "private" });
    return result.removed > 0;
}

async function clearAll(ctx: Context): Promise<boolean> {
    const result = await ctx.database.remove(MESSAGE_TABLE, { "channel.type": "guild" });
    ctx.emit("scenario/clearAll");
    return result.removed > 0;
}

async function clearChannel(ctx: Context, id: string): Promise<boolean> {
    const result = await ctx.database.remove(MESSAGE_TABLE, { "channel.id": id });
    ctx.emit("scenario/clear", id);
    return result.removed > 0;
}
