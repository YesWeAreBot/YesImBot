import { h, Session, Element } from 'koishi';
import { XMLParser } from "fast-xml-parser";

import { Config } from '../config';
import { ChatMessage, getChannelType } from '../models/ChatMessage';
import { BaseAdapter } from "../adapters/base";
import { isEmpty, Template } from './string';
import { getFileUnique, getMemberName, getFormatDateTime } from './toolkit';
import { ImageViewer } from '../services/imageViewer';
import { convertUrltoBase64 } from "../utils/imageUtils";
import { Message, AssistantMessage, ImageComponent, TextComponent, UserMessage } from "../adapters/creators/component";


/**
 * 处理用户消息
 * @param config
 * @param session
 * @param messages
 * @returns
 */
export async function processContent(config: Config, session: Session, messages: ChatMessage[], imageViewer: ImageViewer, adapter: BaseAdapter, format: "JSON"|"XML"): Promise<Message[]> {
  const useVisionAbility = config.ImageViewer.How === "LLM API 自带的多模态能力" && adapter.ability.includes("识图功能");
  const processedMessage: Message[] = [];
  let pendingProcessImgCount = 0;

  for (let chatMessage of messages) {
    if (chatMessage.sender.id === session.selfId || !isEmpty(chatMessage.raw)) {
      if (isEmpty(chatMessage.raw)) {
        chatMessage.raw = convertChatMessageToRaw(chatMessage, format);
      }
      try {
        // 先转换为JSON格式
        chatMessage.raw = convertFormat(chatMessage.raw, "JSON");
      } catch (e) {
      }
      // 把它转换成一个JSON对象，然后
      // 按照config.Settings.RemoveTheseFromRAW数组移除对应键的值
      // 再转换成字符串
      const rawObj = JSON.parse(chatMessage.raw);
      for (let key of config.Settings.RemoveTheseFromRAW) {
        rawObj[key] = "";
      }
      chatMessage.raw = JSON.stringify(rawObj);
      // 再转换为format格式
      chatMessage.raw = convertFormat(chatMessage.raw, format);
    }
    const timeString = getFormatDateTime(chatMessage.sendTime);
    let senderName: string;
    switch (config.Bot.NickorName) {
      case "群昵称":
        senderName = chatMessage.sender.nick;
        break;
      case "用户昵称":
      default:
        senderName = chatMessage.sender.name;
        break;
    }
    const template = config.Settings.SingleMessageStrctureTemplate;
    let elements: Element[];
    try {
      if (isEmpty(chatMessage.content)) continue;
       elements = h.parse(chatMessage.content);
    } catch(e) {
      continue;
    }

    let components: (TextComponent | ImageComponent)[] = [];
    let userContent: string[] = [];
    for (let elem of elements) {
      switch (elem.type) {
        case "text":
          if (useVisionAbility) {
            components.push(TextComponent(elem.attrs.content));
          } else {
            userContent.push(elem.attrs.content);
          }
          break;
        case "at":
          const attrs = { ...elem.attrs };
          let userName: string;
          switch (config.Bot.NickorName) {
            case "群昵称":
              userName = messages.filter((m) => m.sender.id === attrs.id)[0]?.sender.nick
              break;
            case "用户昵称":
            default:
              userName = messages.filter((m) => m.sender.id === attrs.id)[0]?.sender.name;
              break;
          }
          if (attrs.id === session.selfId && config.Bot.SelfAwareness === "此页面设置的名字") {
            userName = config.Bot.BotName;
          }
          // 似乎getMemberName的实现有问题，无法正确获取到群昵称，总是获取到用户昵称。修复后，取消注释下面的代码
          attrs.name = userName || attrs.name || await getMemberName(config, session, attrs.id, chatMessage.channelId);
          const safeAttrs = Object.entries(attrs)
            .map(([key, value]) => {
              // 确保value是字符串
              const strValue = String(value);
              // 转义单引号和其他潜在的危险字符
              const safeValue = strValue
                .replace(/'/g, "&#39;")
                .replace(/"/g, "&quot;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;");
              return `${key}='${safeValue}'`;
            })
            .join(' ');
          const atMessage = `<at ${safeAttrs}/>`;
          if (useVisionAbility) {
            components.push(TextComponent(atMessage));
          } else {
            userContent.push(atMessage);
          }
          break;
        case "quote":
          // 不转义，让LLM自己生成quote标签来使用引用功能
          const quoteMessage = `<quote id='${elem.attrs.quoteMessageId || elem.attrs.id || '未知'}'/>`;
          if (useVisionAbility) {
            components.push(TextComponent(quoteMessage));
          } else {
            userContent.push(quoteMessage);
          }
          break;
        case "img":
          let cacheKey = getFileUnique(elem, session.bot.platform);
          if (useVisionAbility) {
            elem.attrs.cachekey = cacheKey;
            components.push(ImageComponent(h.img(elem.attrs.src, { cachekey: elem.attrs.cachekey, summary: elem.attrs.summary }).toString()));
            pendingProcessImgCount++;
          } else {
            userContent.push(await imageViewer.getImageDescription(elem.attrs.src, cacheKey, elem.attrs.summary, config.Debug.DebugAsInfo));
          }
          break;
        case "face":
          const faceMessage = `[表情:${elem.attrs.name}]`;
          if (useVisionAbility) {
            components.push(TextComponent(faceMessage));
          } else {
            userContent.push(faceMessage);
          }
          break;
        case "mface":
          const mfaceMessage = `[表情:${elem.attrs.summary?.replace(/^\[|\]$/g, '')}]`;
          if (useVisionAbility) {
            components.push(TextComponent(mfaceMessage));
          } else {
            userContent.push(mfaceMessage);
          }
          break;
        default:
          break;
      }
    }

    let channelType = getChannelType(chatMessage.channelId);
    let channelInfo = channelType === "guild" ? `guild:${chatMessage.channelId}` : `${chatMessage.channelId}`;
    let messageText = new Template(template, /\{\{(\w+(?:\.\w+)*)\}\}/g, /\{\{(\w+(?:\.\w+)*),([^,]*),([^}]*)\}\}/g).render({
      messageId: chatMessage.messageId,
      date: timeString,
      channelType,
      channelInfo,
      channelId: chatMessage.channelId,
      senderName,
      senderId: chatMessage.sender.id,
      userContent: useVisionAbility ? "{{userContent}}" : userContent.join(""),
      isPrivate: channelType === "private",
    });

    if (useVisionAbility) {
      const parts = messageText.split(/({{userContent}})/);
      components = parts.flatMap(part => {
        if (part === '{{userContent}}') {
          return components;
        }
        return [TextComponent(part)];
      });
    }

    if (chatMessage.sender.id === session.bot.selfId) {
      if (config.Settings.AssistantFormat === "RAW") {
        messageText = chatMessage.raw;
      }
      if (config.Settings.AddRoleTagBeforeContent) {
        messageText = `[assistant] ${messageText}`;
      }
      if (config.Settings.SendAssistantMessageAs === "USER") {
        processedMessage.push(useVisionAbility ? UserMessage(...components) : UserMessage(messageText));
      } else {
        processedMessage.push(useVisionAbility ? AssistantMessage(...components) : AssistantMessage(messageText));
      }
    } else {
      if (config.Settings.AddRoleTagBeforeContent) {
        messageText = `[user] ${messageText}`;
      }
      processedMessage.push(useVisionAbility ? UserMessage(...components) : UserMessage(messageText));
    }
  }

  if (useVisionAbility) {
    // 处理图片组件
    for (const message of processedMessage) {
      if (typeof message.content === 'string') continue;

      for (let i = 0; i < message.content.length; i++) {
        const component = message.content[i];
        if (component.type !== 'image_url') continue;
        // 解析图片URL中的属性
        const elem = h.parse((component as ImageComponent).image_url.url)[0];
        const cacheKey = elem.attrs.cachekey;
        const src = elem.attrs.src;
        const summary = elem.attrs.summary;

        if (pendingProcessImgCount > config.ImageViewer.Memory && config.ImageViewer.Memory !== -1) {
          // 获取图片描述
          const description = await imageViewer.getImageDescription(src, cacheKey, summary, config.Debug.DebugAsInfo);
          message.content[i] = TextComponent(description);
        } else {
          // 转换为base64
          const base64 = await convertUrltoBase64(src);
          message.content[i] = ImageComponent(base64, config.ImageViewer.Server?.Detail || "auto");
        }

        pendingProcessImgCount--;
      }

      // 合并每条message中相邻的 TextComponent
      message.content = message.content.reduce((acc, curr, i) => {
        if (i === 0) return [curr];

        const prev = acc[acc.length - 1];
        if (prev.type === 'text' && curr.type === 'text') {
          // 合并相邻的 TextComponent
          prev.text += (curr as TextComponent).text;
          return acc;
        }

        return [...acc, curr];
      }, []);
    }
  }

  // 合并连续的 UserMessage 和 AssistantMessage，使得User或Assistant消息不连续出现。如果最后一个消息是AssistantMessage，那么在最后添加一个空UserMessage
  if (config.Settings.MergeConsecutiveMessages) {
    const mergedMessages: Message[] = [];
    let lastMessageType: 'user' | 'assistant' | 'system' | 'tool' | null = null;

    for (const message of processedMessage) {
      const currentMessageType = message.role;

      if (currentMessageType === lastMessageType && (currentMessageType === 'user' || currentMessageType === 'assistant')) {
        // 与前一条相同role的消息合并
        const lastMessage = mergedMessages[mergedMessages.length - 1];

        if (typeof lastMessage.content === 'string' && typeof message.content === 'string') {
          lastMessage.content += '\n' + message.content;
        } else if (Array.isArray(lastMessage.content) && Array.isArray(message.content)) {
          lastMessage.content.push(...message.content);
        } else {
          mergedMessages.push(message);
          lastMessageType = currentMessageType;
        }
      } else {
        mergedMessages.push(message);
        lastMessageType = currentMessageType;
      }
    }

    // 如果最后一条消息是AssistantMessage，那么在最后添加一个空UserMessage
    if (mergedMessages.length > 0 && mergedMessages[mergedMessages.length - 1].role === 'assistant') {
      mergedMessages.push(UserMessage(''));
    }

    return mergedMessages;
  }

  return processedMessage;
}

/**
 * 文本分割和关键词替换
 * @param splitRule 用于分割文本的正则表达式规则
 * @param replaceRules 用于替换文本中关键词的规则数组
 * @param text 待处理的原始文本
 * @returns 处理后的句子数组
 */
export function processText(splitRule: Config["Bot"]["BotReplySpiltRegex"], replaceRules: Config["Bot"]["BotSentencePostProcess"], text: string): string[] {
  const replacements = replaceRules.map(item => ({
    regex: new RegExp(item.replacethis, 'g'),
    replacement: item.tothis || "",
  }));
  let quoteMessageId;
  let splitRegex = new RegExp(splitRule);
  const sentences: string[] = [];
  // 发送前先处理 Bot 消息
  h.parse(text).forEach((node) => {
    // 只针对纯文本进行处理
    if (node.type === "text") {
      let text: string = node.attrs.content;
      // 关键词替换
      for (let { regex, replacement } of replacements) {
        text = text.replace(regex, replacement);
      }
      // 分句
      let temp = text.split(splitRegex);
      let last = sentences.pop() || "";
      let first = temp.shift() || "";
      sentences.push(last + first, ...temp);
    } else if (node.type === "quote") {
      quoteMessageId = node.attrs.id;
    } else {
      let temp = sentences.pop() || "";
      temp += node.toString();
      sentences.push(temp);
    }
  });
  if (quoteMessageId) sentences[0] = h.quote(quoteMessageId).toString() + sentences[0];
  return sentences;
}

function convertChatMessageToRaw(chatMessage: ChatMessage, format: "JSON" | "XML"): string {
  if (format === "JSON") {
    return JSON.stringify({
      status: "success",
      replyTo: chatMessage.channelId,
      nextReplyIn: 1,
      logic: `突然好想说：${chatMessage.content}`,
      reply: chatMessage.content,
      check: "",
      finalReply: chatMessage.content,
      functions: [],
    });
  } else if (format === "XML") {
    return `<status>success</status><replyTo>${chatMessage.channelId}</replyTo><nextReplyIn>1</nextReplyIn><logic>突然好想说：${chatMessage.content}</logic><reply>${chatMessage.content}</reply><check></check><finalReply>${chatMessage.content}</finalReply><functions></functions>`;
  }
}

function convertFormat(input:string, targetFormat:"JSON" | "XML"): string {
  // 从字符串中提取JSON或XML格式的内容
  function strip(original: string): string {
    const regex = new RegExp(`\\\`\\\`\\\`(json|xml)\\s*\\n([\\s\\S]*?)\\n\\\`\\\`\\\`|({[\\s\\S]*}|<[\\s\\S]*?>[\\s\\S]*<\\/[\\s\\S]*?>)`,'gis');
    let contentToParse = null;
    let match;

    while ((match = regex.exec(original)) !== null) {
      const lang = match[1];
      const codeContent = match[2];
      const directContent = match[3];
      if (lang && (lang.toUpperCase() === "JSON" || lang.toUpperCase() === "XML")) {
        contentToParse = codeContent;
        break;
      }
      if (directContent) {
        const trimmed = directContent.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('<')) {
            contentToParse = directContent;
            break;
        }
      }
    }
    return contentToParse;
  }

  // 检测输入的格式
  function detectFormat(str) {
    str = str.trim();
    if (str.startsWith("{") && str.endsWith("}")) {
      return "JSON";
    } else if (str.startsWith("<") && str.endsWith(">")) {
      return "XML";
    }
    return "UNKNOWN";
  }

  // JSON 转 XML
  function json2xml(obj) {
    let xml = '';
    for (let key in obj) {
      // 处理空值
      if (obj[key] === null || obj[key] === undefined) {
        xml += `<${key}></${key}>`;
        continue;
      }

      if (key === 'functions') {
        // 特殊处理 functions 对象或数组
        xml += `<${key}>`;
        const functionsObj = obj[key];
        if (Array.isArray(functionsObj)) {
          functionsObj.forEach(func => {
            xml += `<function>${json2xml(func)}</function>`;  // 包裹数组元素
          });
        } else if (typeof functionsObj === 'object' && functionsObj.function) {
          const funcList = Array.isArray(functionsObj.function) ? functionsObj.function : [functionsObj.function];
          funcList.forEach(func => {
            xml += `<function>${json2xml(func)}</function>`;  // 包裹数组元素
          });
        }
        xml += `</${key}>`;
      } else if (Array.isArray(obj[key])) {
        xml += `<${key}>`;
        obj[key].forEach(item => {
          if (typeof item === 'object' && item !== null) {
            xml += json2xml(item);
          } else {
            xml += `<item>${item || ''}</item>`;
          }
        });
        xml += `</${key}>`;
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        xml += `<${key}>${json2xml(obj[key])}</${key}>`;
      } else {
        xml += `<${key}>${obj[key] || ''}</${key}>`;
      }
    }
    return xml;
  }

  // XML 转 JSON
  function xml2json(xmlStr: string) {
    const parser = new XMLParser({
      ignoreAttributes: false,
      processEntities: false,
      stopNodes: ['*.logic', '*.reply', '*.check', '*.finalReply'],
      isArray: (name, jPath) => {
        return jPath === 'functions.function' || name === 'function';
      },
    });

    const parsed = parser.parse(xmlStr);

    if (parsed.functions?.function) {
      parsed.functions = parsed.functions.function;
    }
    return parsed
  }

  input = strip(input);

  const inputFormat = detectFormat(input);

  if (inputFormat === targetFormat) {
    return input;
  }

  if (inputFormat === "JSON" && targetFormat === "XML") {
    return json2xml(JSON.parse(input));
  } else if (inputFormat === "XML" && targetFormat === "JSON") {
    return JSON.stringify(xml2json(input));
  }

  throw new Error(`Unsupported conversion from ${inputFormat} to ${targetFormat}`);
}
