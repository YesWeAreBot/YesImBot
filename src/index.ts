import { Context, Next, Random, Session } from "koishi";
import { LoggerService } from "@cordisjs/logger";
import { h, sleep } from "koishi";

import { Config } from "./config";
import { containsFilter, getBotName, isChannelAllowed, getFileUnique, getFormatDateTime } from "./utils/toolkit";
import { ensurePromptFileExists, genSysPrompt } from "./utils/prompt";
import { MarkType, SendQueue } from "./services/sendQueue";
import { outputSchema } from "./adapters/creators/schema";
import { initDatabase } from "./database";
import { processContent, processText } from "./utils/content";
import { foldText, isEmpty } from "./utils/string";
import { ChannelType, createMessage } from "./models/ChatMessage";
import { convertUrltoBase64 } from "./utils/imageUtils";
import { Bot, FailedResponse, SkipResponse, SuccessResponse } from "./bot";
import { apply as applyMemoryCommands } from "./commands/memory";
import { apply as applySendQueneCommands } from "./commands/sendQuene";

export const name = "yesimbot";

export const usage = `
"Yes! I'm Bot!" 是一个能让你的机器人激活灵魂的插件。\n
使用请阅读 [Github README](https://github.com/HydroGest/YesImBot/blob/main/readme.md)，推荐使用 [GPTGOD](https://gptgod.online/#/register?invite_code=envrd6lsla9nydtipzrbvid2r) 提供的 GPT-4o-mini 模型以获得最高性价比。\n
官方交流 & 测试群：[857518324](http://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=k3O5_1kNFJMERGxBOj1ci43jHvLvfru9&authKey=TkOxmhIa6kEQxULtJ0oMVU9FxoY2XNiA%2B7bQ4K%2FNx5%2F8C8ToakYZeDnQjL%2B31Rx%2B&noverify=0&group_code=857518324)
`;

export { Config } from "./config";

export const DATABASE_NAME = name;

export const inject = {
  required: ["database"],
  optional: ["censor", "qmanager", "interactions"]
}

declare global {
  var logger: LoggerService;
}

export function apply(ctx: Context, config: Config) {
  globalThis.logger = ctx.logger;
  let shouldReTrigger = false;
  let bot = new Bot(ctx, config);

  initDatabase(ctx);
  const sendQueue = new SendQueue(ctx, config);
  const minTriggerTimeHandlers: Map<string, ReturnType<typeof ctx.debounce<(session: Session) => Promise<boolean>>>> = new Map();
  const maxTriggerTimeHandlers: Map<string, ReturnType<typeof ctx.debounce<(session: Session) => Promise<boolean>>>> = new Map();

  ctx.on("ready", async () => {
    process.setMaxListeners(20);

    if (!config.Settings.UpdatePromptOnLoad) return;
    ctx.logger.info("正在尝试更新 Prompt 文件...");
    await ensurePromptFileExists(
      config.Bot.PromptFileUrl[config.Bot.PromptFileSelected],
      true,
      config.Debug.DebugAsInfo
    );
  });

  ctx.on("dispose", async () => {
    for (let [channelId, handler] of [
      ...minTriggerTimeHandlers,
      ...maxTriggerTimeHandlers,
    ]) {
      handler.dispose?.();
      try {
        minTriggerTimeHandlers.delete(channelId);
        maxTriggerTimeHandlers.delete(channelId);
      } catch (error) {
        ctx.logger.error(error);
      }
    }
  });

  ctx.on("message-created", async (session) => {
    // 等待1毫秒
    await sleep(1)
    const channelId = session.channelId;

    // 添加自身消息。可能会先于middleware执行导致bot的消息不带raw
    if (session.author.id == session.selfId && channelId != config.Settings.LogicRedirect.Target) {
      await sendQueue.addMessage(await createMessage(session));
    }
    if (!isChannelAllowed(config.MemorySlot.SlotContains, channelId) || session.author.id == session.selfId || channelId === config.Settings.LogicRedirect.Target) {
      return;
    }
    if (config.MemorySlot.MaxTriggerTime > 0) {
      if (!maxTriggerTimeHandlers.has(channelId)) {
        maxTriggerTimeHandlers.set(
          channelId,
          ctx.debounce(async (session: Session): Promise<boolean> => {
            if (await handleMessage(session)) return true;
            if (shouldReTrigger) {
              if (await handleMessage(session)) return true;
            }
          }, config.MemorySlot.MaxTriggerTime * 1000)
        );
      }
      if (await maxTriggerTimeHandlers.get(channelId)(session)) return;
    }
  });

  applyMemoryCommands(ctx, bot);
  applySendQueneCommands(ctx, sendQueue);

  ctx.middleware(async (session: Session, next: Next) => {
    const channelId = session.channelId;
    if (!isChannelAllowed(config.MemorySlot.SlotContains, channelId) || session.author.id == session.selfId) {
      return next();
    }

    if (containsFilter(session.content, config.MemorySlot.Filter)) {
      ctx.logger.info(`Message filtered, guildId = ${session.channelId}, content = ${foldText(session.content, 1000)}`);
      sendQueue.setMark(session.messageId, MarkType.Ignore);
      return next();
    }

    // 确保消息入库
    await sendQueue.addMessage(await createMessage(session));

    const parsedElements = h.parse(session.content);

    // 提前下载图片，防止链接过期
    parsedElements.forEach((element) => {
      if (element.type !== "img") return;
      const cacheKey = getFileUnique(element, session.bot.platform);
      convertUrltoBase64(
        element.attrs.src,
        cacheKey,
        config.Debug.IgnoreImgCache,
        config.Debug.DebugAsInfo
      )
        .then(async () => {
          if (config.ImageViewer.DescribeImmidately) {
            await bot.imageViewer.getImageDescription(
              element.attrs.src,
              cacheKey,
              element.attrs.summary,
              config.Debug.DebugAsInfo
            );
          }
        })
        .catch((reason) => {
          ctx.logger.warn(`Image[${element.attrs.src}] download failed. ${reason}`);
        });
    });

    // 检查是否应该回复
    // 检测是否达到发送次数或被 at
    // 返回 false 的条件：
    // 达到触发条数 或者 用户消息提及机器人且随机条件命中。也就是说：
    // 如果触发条数没有达到 (!isTriggerCountReached)
    // 并且消息没有提及机器人或者提及了机器人但随机条件未命中 (!(isAtMentioned && shouldReactToAt))
    // 那么就会执行内部的代码，即跳过这个中间件，不向api发送请求
    const loginStatus = await session.bot.getLogin();
    const isBotOnline = loginStatus.status === 1;

    const isAtMentioned = parsedElements.some(element =>
      element.type === 'at' &&
      (element.attrs.id === session.bot.selfId || element.attrs.type === 'all' || (isBotOnline && element.attrs.type === 'here'))
    );
    const shouldReactToAt = Random.bool(config.MemorySlot.AtReactPossibility);
    const isTriggerCountReached = sendQueue.checkTriggerCount(channelId);
    const shouldReply = (isAtMentioned && shouldReactToAt) || isTriggerCountReached || config.Debug.TestMode

    if (!shouldReply) return next();
    if (!minTriggerTimeHandlers.has(channelId)) {
      minTriggerTimeHandlers.set(
        channelId,
        ctx.debounce(async (session): Promise<boolean> => {
          if (await handleMessage(session)) return true;
          if (shouldReTrigger) {
            if (await handleMessage(session)) return true;
          }
        }, config.MemorySlot.MinTriggerTime)
      );
    }
    if(await minTriggerTimeHandlers.get(channelId)(session)) return next();
  });

  /**
   * Return true 表示拦截后续中间件，即return next()
   */
  async function handleMessage(session: Session): Promise<boolean> {
    const channelId = session.channelId;

    // 获取锁，没有就会创建一个
    const channelMutex = sendQueue.getChannelMutex(channelId);
    // 检查是否已经被锁，是就跳过，并且后续再次触发
    if (channelMutex.isLocked()) {
      if (config.Debug.DebugAsInfo)
        ctx.logger.info(`频道 ${channelId} 正在处理另一个回复，跳过当前回复生成`);
      shouldReTrigger = true;
      return false;
    }
    shouldReTrigger = false;
    // 尝试获取锁
    const release = await channelMutex.acquire();

    try {
      // 处理内容
      const chatHistory = await processContent(config, session, await sendQueue.getMixedQueue(channelId, 100), bot.imageViewer);

      // 生成响应
      if (!chatHistory || (Array.isArray(chatHistory) && chatHistory.length === 0)) {
        if (config.Debug.DebugAsInfo) ctx.logger.info(`未获取到${channelId}的聊天记录`);
        return false;
      }

      if (config.Debug.DebugAsInfo) ctx.logger.info("ChatHistory:\n" + JSON.stringify(chatHistory, null, 2));

      bot.setSession(session);
      bot.setChatHistory(chatHistory);

      let botName = await getBotName(config.Bot, session);

      bot.setSystemPrompt(
        await genSysPrompt(
          config.Bot.PromptFileUrl[config.Bot.PromptFileSelected],
          {
            config: config,
            curDate: getFormatDateTime(),
            curGroupId: channelId,
            BotName: botName,
            BotSelfId: session.bot.selfId,
            outputSchema,
            coreMemory: await bot.getCoreMemory(session.selfId),
          }
        )
      );

      if (config.Debug.DebugAsInfo) ctx.logger.info(`Request sent, awaiting for response...`);

      const chatResponse = await bot.generateResponse([], config.Debug.DebugAsInfo);

      // 处理响应
      let { status, raw, adapterIndex: current, usage } = chatResponse;

      let template = "";

      if (status === "fail") {
        const { reason } = chatResponse as FailedResponse;
        template = `
LLM 的响应无法正确解析，来自 API ${current}
${reason}
原始响应:
${raw}
---
消耗: 输入 ${usage?.prompt_tokens}, 输出 ${usage?.completion_tokens}`;

        ctx.logger.error(`LLM provides unexpected response:\n${raw}`);
        return false;
      } else if (status === "skip") {
        const { nextTriggerCount, logic, functions } = chatResponse as SkipResponse;
        template = `
${botName}想要跳过此次回复，来自 API ${current}
---
逻辑：${logic}
---
指令：${functions?.length ? functions : "无"}
---
距离下次：${nextTriggerCount}
---
消耗：输入 ${usage?.prompt_tokens}，输出 ${usage?.completion_tokens}`
        ctx.logger.info(`${botName}想要跳过此次回复`);
        await sendQueue.addRawMessage(session, raw);
        sendQueue.setTriggerCount(channelId, nextTriggerCount);
        return true
      }

      // status === "success"
      let { replyTo, finalReply, nextTriggerCount, logic, functions, quote } = chatResponse as SuccessResponse;

      if (isEmpty(replyTo)) replyTo = session.channelId;

      sendQueue.setTriggerCount(channelId, nextTriggerCount);
      template = `
回复于 ${replyTo} 的消息已生成，来自 API ${current}
---
内容：${finalReply && finalReply.trim() ? finalReply : "无"}
---
逻辑：${logic}
---
指令：${functions?.length ? functions : "无"}
---
距离下次：${nextTriggerCount}
---
消耗：输入 ${usage?.prompt_tokens}，输出 ${usage?.completion_tokens}`;
      await redirectLogicMessage(config, session, sendQueue, template);

      //如果 AI 使用了指令
      if (Array.isArray(functions) && functions.length > 0) {
        functions.forEach(async (func) => {
          try {
            await bot.callFunction(func.name, func.params);
            ctx.logger.info(`已执行指令：${func.name}`);
          } catch (error) {
            ctx.logger.error(`执行指令<${func.name}>时出错: ${error}`);
          }
        });
      }

      if (!isEmpty(finalReply)) {

        if (config.Verifier.Enabled && !bot.verifier.verifyResponse(replyTo, finalReply)) {
          if (config.Verifier.Action === "丢弃") {
            return true;
          } else {
            shouldReTrigger = true;
            return false;
          }
        }

        let messageIds = [];
        let sentences = processText(config["Bot"]["BotReplySpiltRegex"], config["Bot"]["BotSentencePostProcess"], finalReply);
        if (!isEmpty(quote)) sentences[0] = h.quote(quote).toString() + sentences[0];
        for (let sentence of sentences) {
          if (isEmpty(sentence)) continue;

          // @ts-ignore
          if (ctx?.censor) sentence = await ctx?.censor?.transform(sentence, session) || sentence;

          if (config.Bot.WordsPerSecond > 0) {
            // 按照字数等待
            const waitTime = Math.ceil(sentence.length / config.Bot.WordsPerSecond);
            await sleep(waitTime * 1000);
          }

          let arr = (replyTo === session.channelId)
            ? await session.sendQueued(sentence)
            : await session.bot.sendMessage(replyTo, sentence);
          messageIds = messageIds.concat(arr);
        }

        await sendQueue.addMessage({
          senderId: session.selfId,
          senderName: session.bot.user.name,
          senderNick: botName,
          messageId: messageIds[0],
          channelId: replyTo,
          channelType: replyTo.startsWith("private:") ? ChannelType.Private : (replyTo === "#" ? ChannelType.Sandbox : ChannelType.Guild),
          sendTime: new Date(),
          content: finalReply,
          quoteMessageId: quote,
          raw,
        });

        for (const messageId of messageIds) {
          sendQueue.setMark(messageId, MarkType.Added);
        }
      }
      return true;
    }

    catch (error) {
      ctx.logger.error(`处理消息时出错: ${error.stack}`);
      return false;
    }

    finally {
      release();
    }
  }
}

export async function redirectLogicMessage(
  config: Config,
  session: Session,
  sendQueue: SendQueue,
  message: string,
) {
  if (!config.Settings.LogicRedirect.Enabled) return;
  const messageIds = await session.bot.sendMessage(config.Settings.LogicRedirect.Target, message);
  for (const messageId of messageIds) {
    sendQueue.setMark(messageId, MarkType.LogicRedirect);
  }
}
