import { Context, h, Next, Random, Session, sleep } from "koishi";

import path from "path";
import { getOutputSchema } from "./adapters/creators/schema";
import { Bot } from "./bot";
import { apply as applyExtensionCommands } from "./commands/extension";
import { apply as applySendQueueCommands } from "./commands/sendQueue";
import { Config } from "./config";
import { initDatabase } from "./database";
import { EmojiManager } from "./managers/emojiManager";
import { createMessage, getChannelType } from "./models/ChatMessage";
import { FailedResponse, SkipResponse, SuccessResponse } from "./models/LLMResponse";
import { ImageViewer } from "./services/imageViewer";
import { MarkType, SendQueue } from "./services/sendQueue";
import { ResponseVerifier } from "./utils/verifier";
import { processContent, processText } from "./utils/content";
import { convertUrltoBase64, ImageCache } from "./utils/imageUtils";
import { ensurePromptFileExists, genSysPrompt } from "./utils/prompt";
import { foldText, isEmpty } from "./utils/string";
import { containsFilter, getBotName, getFileUnique, getFormatDateTime, isChannelAllowed, toolsToString } from "./utils/toolkit";

export const name = "yesimbot";

export const reusable = true;

export const usage = `
"Yes! I'm Bot!" 是一个能让你的机器人激活灵魂的插件。\n
使用请阅读 [Github README](https://github.com/HydroGest/YesImBot/blob/main/readme.md)，推荐使用 [GPTGOD](https://gptgod.online/#/register?invite_code=envrd6lsla9nydtipzrbvid2r) 提供的 llama-3.1-405b 模型以获得最高性价比。\n
官方交流 & 测试群：[857518324](http://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=k3O5_1kNFJMERGxBOj1ci43jHvLvfru9&authKey=TkOxmhIa6kEQxULtJ0oMVU9FxoY2XNiA%2B7bQ4K%2FNx5%2F8C8ToakYZeDnQjL%2B31Rx%2B&noverify=0&group_code=857518324)
`;

export { Config } from "./config";

export const inject = {
  required: ["database"],
  optional: [
    "censor",
    "memory"
  ],
}

export function apply(ctx: Context, config: Config) {
  let shouldReTrigger = false;

  const emojiManager = config.Embedding.Enabled ? new EmojiManager(config.Embedding, ctx.baseDir) : null;
  const verifier = config.Verifier.Enabled ? new ResponseVerifier(ctx, config) : null;
  const imageViewer = new ImageViewer(ctx, config);

  ImageCache.instance = new ImageCache(path.join(ctx.baseDir, "data/yesimbot/cache/downloadImage"));;

  const bot = new Bot({
    ctx,
    config,
    emojiManager,
    verifier,
    imageViewer
  });

  initDatabase(ctx);
  const sendQueue = new SendQueue(ctx, config);
  const minTriggerTimeHandlers: Map<string, ReturnType<typeof ctx.debounce<(session: Session) => Promise<boolean>>>> = new Map();
  const maxTriggerTimeHandlers: Map<string, ReturnType<typeof ctx.debounce<(session: Session) => Promise<boolean>>>> = new Map();

  ctx.on("ready", async () => {
    process.setMaxListeners(20);

    if (config.Settings.UpdatePromptOnLoad) {
      ctx.logger.info("正在尝试更新 Prompt 文件...");
      await ensurePromptFileExists(
        config.Bot.PromptFileUrl[config.Bot.PromptFileSelected],
        true,
        config.Debug.DebugAsInfo
      );
    }
  });

  ctx.on("command/before-execute", async ({ session, command }) => {
    sendQueue.setMark(session.messageId, MarkType.Command);
  })

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
    await sleep(1);
    const channelId = session.channelId;

    if (!isChannelAllowed(config.MemorySlot.SlotContains, channelId)) {
      return;
    }

    if (channelId === config.Settings.LogicRedirect.Target) {
      sendQueue.setMark(session.messageId, MarkType.LogicRedirect);
      return;
    }

    if (session.author.id == session.selfId) {
      // 添加自身消息。可能会先于middleware执行导致bot的消息不带raw
      // 不是由LLM生成的消息
      await sendQueue.processingLock.waitForProcess(session.messageId);
      await sendQueue.addMessage(await createMessage(session));
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

  // 注册指令
  try {
    //applyMemoryCommands(ctx, bot);
    applySendQueueCommands(ctx, sendQueue);
    applyExtensionCommands(ctx);
  } catch (error) {

  }


  ctx.middleware(async (session: Session, next: Next) => {
    const platform = session.platform;
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
    if (await minTriggerTimeHandlers.get(channelId)(session)) return next();
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
      const chatHistory = await processContent(config, session, await sendQueue.getMixedQueue(channelId), bot.imageViewer);

      // 生成响应
      if (!chatHistory || (Array.isArray(chatHistory) && chatHistory.length === 0)) {
        if (config.Debug.DebugAsInfo) ctx.logger.info(`未获取到${channelId}的聊天记录`);
        return false;
      }

      if (config.Debug.DebugAsInfo) {
        ctx.logger.info("ChatHistory:\n" + chatHistory.map(item => {
          const content = typeof item.content === 'object' ?
            JSON.stringify(item.content, null, 2) :
            item.content;
          return `${content}`;
        }).join("\n"));
      }
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
            outputSchema: getOutputSchema(bot.finalFormat),
            functionPrompt: "{{functionPrompt}}",
            // 记忆模块还未完成，等完成后取消注释
            // coreMemory: await bot.getCoreMemory(session.selfId),
            memory: await bot.getMemory(session.selfId),
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
---
原因: ${reason}
原始响应: ${raw}
---
消耗: 输入 ${usage?.prompt_tokens}, 输出 ${usage?.completion_tokens}`;
        ctx.logger.error(`LLM 的响应无法正确解析。\n原因: ${reason} \n原始响应: ${raw}`);
        return false;
      } else if (status === "skip") {
        let { nextTriggerCount, logic, functions } = chatResponse as SkipResponse;
        template = `
${botName}想要跳过此次回复，来自 API ${current}
---
逻辑：${logic}
---
指令：
${toolsToString(functions)}
---
距离下次：${nextTriggerCount}
---
消耗：输入 ${usage?.prompt_tokens}，输出 ${usage?.completion_tokens}`
        ctx.logger.info(`${botName}想要跳过此次回复`);
        //await sendQueue.addRawMessage(session, raw);

        //如果 AI 使用了指令
        if (functions.length > 0) {
          if (config.Debug.DebugAsInfo) {
            ctx.logger.info(`Bot[${session.selfId}] 想要调用工具`)
            ctx.logger.info(functions.map(func => `Name: ${func.name}\nArgs: ${JSON.stringify(func.params)}`).join('\n'));
          }
          for (const func of functions) {
            const { name, params } = func;
            try {
              let returnValue = await bot.callFunction(name, params);
              ctx.logger.info(`已执行指令：${func.name}`);
            } catch (error) {
              ctx.logger.error(`执行指令<${func.name}>时出错: ${error}`);
            }
          }
        }

        sendQueue.setTriggerCount(channelId, nextTriggerCount);
        return true
      }

      // status === "success"
      let { replyTo, finalReply, nextTriggerCount, logic, functions } = chatResponse as SuccessResponse;

      if (isEmpty(replyTo)) replyTo = session.channelId;


      sendQueue.setTriggerCount(channelId, nextTriggerCount);
      template = `
回复于 ${replyTo} 的消息已生成，来自 API ${current}
---
内容：${finalReply && finalReply.trim() ? finalReply : "无"}
---
逻辑：${logic}
---
指令：
${toolsToString(functions)}
---
距离下次：${nextTriggerCount}
---
消耗：输入 ${usage?.prompt_tokens}，输出 ${usage?.completion_tokens}`;
      await redirectLogicMessage(config, session, sendQueue, template);

      //如果 AI 使用了指令
      if (functions.length > 0) {
        if (config.Debug.DebugAsInfo) {
          ctx.logger.info(`Bot[${session.selfId}] 想要调用工具`)
          ctx.logger.info(functions.map(func => `Name: ${func.name}\nArgs: ${JSON.stringify(func.params)}`).join('\n'));
        }
        for (const func of functions) {
          const { name, params } = func;
          try {
            let returnValue = await bot.callFunction(name, params);
            ctx.logger.info(`已执行指令：${func.name}`);
          } catch (error) {
            ctx.logger.error(`执行指令<${func.name}>时出错: ${error}`);
          }
        }
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
          arr.forEach((id) => {
            sendQueue.processingLock.start(id);
            messageIds.push(id);
          });
        }

        await sendQueue.addMessage({
          sender: {
            id: session.selfId,
            name: session.bot.user.name,
            nick: botName,
          },
          messageId: messageIds[0],
          channelId: replyTo,
          channelType: getChannelType(session.channelId),
          sendTime: new Date(),
          content: finalReply,
        });

        for (const messageId of messageIds) {
          sendQueue.setMark(messageId, MarkType.Added);
          sendQueue.processingLock.end(messageId);
        }
      }
      return true;
    }

    catch (error) {
      ctx.logger.error(`处理消息时出错: ${error.message}`);
      if (config.Debug.DebugAsInfo) ctx.logger.error(error.stack);
      if (config.Debug.DebugAsInfo) ctx.logger.error(error.stack);
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

export * from "./adapters";
export * from "./database";
export * from "./embeddings";
export * from "./managers/cacheManager";
export * from "./models/ChatMessage";
export * from "./utils/factory";

