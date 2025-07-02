import { Schema } from "koishi";
import { } from "koishi-plugin-adapter-onebot";
import { isEmpty } from "../../../shared";
import { createExtension, createTool, Failed, Success, withCommonParams } from "../helpers";
import { ExtensionMetadata } from "../types";

const metadata: ExtensionMetadata = {
    name: "Interactions",
    version: "1.1.0",
    description: "允许大模型在聊群内进行交互",
    author: "HydroGest",
};

const Reaction = createTool({
    metadata: {
        name: "reaction-create",
        description: `在当前频道对一个或多个消息进行表态。表态编号是数字，这里是一个简略的参考：惊讶(0)，不适(1)，无语(27)，震惊(110)，滑稽(178), 点赞(76)`,
    },
    parameters: withCommonParams({
        message_id: Schema.string().required().description("消息 ID"),
        emoji_id: Schema.number().required().description("表态编号"),
    }),
    execute: async (ctx, { message_id, emoji_id }) => {
        const { koishiContext, koishiSession } = ctx;
        if (isEmpty(message_id) || isEmpty(String(emoji_id))) return Failed("message_id and emoji_id is required");
        try {
            await koishiSession.bot.createReaction(koishiSession.channelId, message_id, emoji_id);
            koishiContext.logger.info(`Bot[${koishiSession.selfId}]对消息 ${message_id} 进行了表态： ${emoji_id}`);
            return Success();
        } catch (e) {
            koishiContext.logger.error(`Bot[${koishiSession.selfId}]执行表态失败: ${message_id}, ${emoji_id} - `, e.message);
            return Failed(`对消息 ${message_id} 进行表态失败： ${e.message}`);
        }
    },
});

const Essence = createTool({
    metadata: {
        name: "essence-create",
        description: `在当前频道将一个消息设置为精华消息。常在你认为某个消息十分重要或过于典型时使用。`,
    },

    parameters: withCommonParams({
        message_id: Schema.string().required().description("消息 ID"),
    }),
    execute: async (ctx, { message_id }) => {
        const { koishiContext, koishiSession } = ctx;
        if (isEmpty(String(message_id))) return Failed("message_id is required");
        try {
            await koishiSession.onebot.setEssenceMsg(message_id);
            koishiContext.logger.info(`Bot[${koishiSession.selfId}]将消息 ${message_id} 设置为精华`);
            return Success();
        } catch (e) {
            koishiContext.logger.error(`Bot[${koishiSession.selfId}]设置精华消息失败: ${message_id} - `, e.message);
            return Failed(`设置精华消息失败： ${e.message}`);
        }
    },
});

const Poke = createTool({
    metadata: {
        name: "send-poke",
        description: `发送戳一戳、拍一拍消息，常用于指定你交流的对象，或提醒某位用户注意。`,
    },

    parameters: withCommonParams({
        user_id: Schema.string().required().description("用户名称"),
        channel: Schema.string().description("要在哪个频道运行，不填默认为当前频道"),
    }),
    execute: async (ctx, { user_id, channel }) => {
        const { koishiContext, koishiSession } = ctx;
        if (isEmpty(String(user_id))) return Failed("user_id is required");
        const targetChannel = isEmpty(channel) ? koishiSession.channelId : channel;
        try {
            await koishiSession.onebot._request("send_poke", { user_id: user_id });
            koishiContext.logger.info(`Bot[${koishiSession.selfId}]戳了戳 ${user_id}`);
            return Success();
        } catch (e) {
            koishiContext.logger.error(`Bot[${koishiSession.selfId}]戳了戳 ${user_id}，但是失败了 - `, e.message);
            return Failed(`戳了戳 ${user_id} 失败： ${e.message}`);
        }
    },
});

// const GetForwardMsg = createTool({
//     metadata: {
//         name: "get_forward_msg",
//         description: `获取合并转发消息的内容，用于查看转发消息的详细信息，如结果仍包含一层，请自己决定是否继续获取。`,
//     },

//     parameters: withCommonParams({
//         id: Schema.string().required().description("合并转发 ID，如在 `[转发聊天记录 #12345]` 中的 12345 即是其 ID"),
//     }),
//     execute: async (ctx, { id }) => {
//         const { koishiContext, koishiSession, platform } = ctx;
//         try {
//             const result = await platform.getForwardMessage(id);
//             const formattedResult = await formatForwardMessage(result, koishiContext);

//             context.koishiContext.logger.info(`Bot[${koishiSession.selfId}]获取转发消息 ${id} 成功`);

//             return Success(formattedResult);
//         } catch (e) {
//             context.koishiContext.logger.error(`Bot[${koishiSession.selfId}]获取转发消息失败: ${id} - `, e.message);
//             return Failed(`获取转发消息失败： ${e.message}`);
//         }
//     },
// });

// async function formatForwardMessage(apiResponse: any, ctx: any): Promise<string> {
//     try {
//         // 兼容不同响应结构
//         const messages = apiResponse.data?.message || apiResponse.message || [];

//         if (!Array.isArray(messages)) {
//             return "无效的消息格式";
//         }

//         const imageProcessor = new ImageProcessor(ctx);

//         const formattedMessages = await Promise.all(
//             messages.map(async (node: any) => {
//                 if (node?.type !== "node") return "";

//                 const { user_id, nickname, content } = node.data || {};
//                 if (!content) return `${nickname || "未知用户"}(${user_id || "?"}): [空内容]`;

//                 const contentParts = await Promise.all(
//                     content.map(async (item: any) => {
//                         try {
//                             if (!item?.type) return "[未知消息类型]";

//                             switch (item.type) {
//                                 case "image":
//                                     const imageData = await imageProcessor.process(item.data?.url);
//                                     return `[图片 #${imageData.id}]`;
//                                 case "text":
//                                     return item.data?.text || "";
//                                 default:
//                                     return item.data?.summary || `[${item.type}消息]`;
//                             }
//                         } catch (e) {
//                             ctx.logger.error("格式化消息部分失败:", e);
//                             return "[内容解析错误]";
//                         }
//                     })
//                 );

//                 return `${nickname || "未知用户"}(${user_id || "?"}): ${contentParts.join("")}`;
//             })
//         );

//         return formattedMessages.filter((msg) => msg.trim()).join("\n") || "无有效消息内容";
//     } catch (e) {
//         ctx.logger.error("格式化转发消息失败:", e);
//         return "消息格式化失败";
//     }
// }

export default createExtension({
    metadata,
    tools: [Reaction, Essence, Poke],
});
