import { Context } from "koishi";
import { MarkType, SendQueue } from "../services/sendQueue";
import { isEmpty } from "../utils/string";

export function apply(ctx: Context, sendQueue: SendQueue) {
  ctx
    .command("清空对话", "清除 BOT 的对话上下文", { authority: 3 })
    .option("target", "-t <target:string> 指定要清空对话的会话。使用 private:指定私聊会话，使用 all 或 private:all 分别清除所有群聊或私聊记忆", { authority: 3 })
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
        const cleared = await sendQueue.clearBySenderId(options.person);
        result = `${cleared ? "✅" : "❌"} 用户 ${options.person}`;
      } else {
        const clearGroupId = options.target || msgDestination;
        // 要清除的会话集合
        const targetGroups = clearGroupId
          .split(",")
          .map((g) => g.trim())
          .filter(Boolean);

        const messages = [];

        if (targetGroups.includes("private:all")) {
          const success = await sendQueue.clearPrivateAll();
          messages.push(`${success ? "✅" : "❌"} 全部私聊会话`);
        }

        if (targetGroups.includes("all")) {
          const success = await sendQueue.clearAll();
          messages.push(`${success ? "✅" : "❌"} 全部群组会话`);
        }

        for (const id of targetGroups) {
          if (id === "all" || id === "private:all") continue;
          const success = await sendQueue.clearChannel(id);
          messages.push(`${success ? "✅" : "❌"} ${id}`);
        }

        result = messages.join("\n");
      }
      if (isEmpty(result)) return;

      const messageIds = await session.sendQueued(result);

      for (const messageId of messageIds) {
        sendQueue.setMark(messageId, MarkType.Command);
      }
      return;
    });
}
