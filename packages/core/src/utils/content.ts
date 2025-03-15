import { h, Session, Element } from 'koishi';
import { XMLParser } from "fast-xml-parser";

import { Config } from '../config';
import { BaseAdapter } from "../adapters/base";
import { ChatMessage, getChannelType } from '../models/ChatMessage';
import { isEmpty, parseJSON, Template } from './string';
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
  if (config.ImageViewer.How === "LLM API 自带的多模态能力" && adapter.ability.includes("识图功能")) {
    return await processContentWithVisionAbility(config, session, messages, imageViewer, format);
  }
  const processedMessage: Message[] = [];

  for (let chatMessage of messages) {
    if (chatMessage.sender.id === session.selfId) {
      if (isEmpty(chatMessage.raw)) {
        chatMessage.raw = convertChatMessageToRaw(chatMessage, format);
      }
      try {
        // 判断chatMessage.raw是JSON格式还是XML格式，再根据format进行转换
        chatMessage.raw = convertFormat(chatMessage.raw, format);
      } catch (e) {
      }

      // TODO: role === tool
      processedMessage.push(AssistantMessage(chatMessage.raw));
      continue;
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
    let userContent: string[] = [];
    for (let elem of elements) {
      switch (elem.type) {
        case "text":
          userContent.push(elem.attrs.content);
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
          userContent.push(atMessage);
          break;
        case "quote":
          userContent.push(`[引用:${elem.attrs.quoteMessageId || elem.attrs.id || '未知'}]`);
          break;
        case "img":
          let cacheKey = getFileUnique(elem, session.bot.platform);
          userContent.push(await imageViewer.getImageDescription(elem.attrs.src, cacheKey, elem.attrs.summary, config.Debug.DebugAsInfo));
          break;
        case "face":
          userContent.push(`[表情:${elem.attrs.name}]`);
          break;
        case "mface":
          userContent.push(`[表情:${elem.attrs.summary?.replace(/^\[|\]$/g, '')}]`);
          break;
        default:
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
      userContent: userContent.join(""),
      // quoteMessageId: chatMessage.quoteMessageId || "",
      // hasQuote: !!chatMessage.quoteMessageId,
      isPrivate: channelType === "private",
    });

    if (chatMessage.sender.id === session.bot.selfId) {
      processedMessage.push(AssistantMessage(messageText));
    } else {
      processedMessage.push(UserMessage(messageText));
    }
  }
  return processedMessage;
}

async function processContentWithVisionAbility(config: Config, session: Session, messages: ChatMessage[], imageViewer: ImageViewer, format: "JSON"|"XML"): Promise<Message[]> {
  const processedMessage: Message[] = [];
  let pendingProcessImgCount = 0;

  for (let chatMessage of messages) {
    if (!isEmpty(chatMessage.raw) || chatMessage.sender.id === session.selfId) {
      if (isEmpty(chatMessage.raw)) {
        chatMessage.raw = convertChatMessageToRaw(chatMessage, format);
      }
      // TODO: role === tool
      chatMessage.raw = convertFormat(chatMessage.raw, format);
      processedMessage.push(AssistantMessage(chatMessage.raw));
      continue;
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
    const elements = h.parse(chatMessage.content);
    let components: (TextComponent | ImageComponent)[] = [];
    for (let elem of elements) {
      switch (elem.type) {
        case "text":
          // const { content } = elem.attrs;
          components.push(TextComponent(elem.attrs.content));
          break;
        case "at":
          const attrs = { ...elem.attrs };
          let userName: string;
          switch (config.Bot.NickorName) {
            case "群昵称":
              userName = messages.filter((m) => m.sender.id === attrs.id)[0]?.sender.nick;
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
          components.push(TextComponent(atMessage));
          break;
        case "quote":
          // const { id } = elem.attrs;
          // chatMessage.quoteMessageId = elem.attrs.id;
          break;
        case "img":
          // const { src, summary, fileUnique } = elem.attrs;
          let cacheKey = getFileUnique(elem, session.bot.platform);
          elem.attrs.cachekey = cacheKey;
          components.push(ImageComponent(h.img(elem.attrs.src, { cachekey: elem.attrs.cachekey, summary: elem.attrs.summary }).toString()));
          pendingProcessImgCount++;
          break;
        case "face":
          // const { id, name } = elem.attrs;
          components.push(TextComponent(`[表情:${elem.attrs.name}]`));
          break;
        case "mface":
          // const { url, summary } = elem.attrs;
          components.push(TextComponent(`[表情:${elem.attrs.summary?.replace(/^\[|\]$/g, '')}]`));
          break;
        default:
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
      userContent: "{{userContent}}",
      // quoteMessageId: chatMessage.quoteMessageId || "",
      // hasQuote: !!chatMessage.quoteMessageId,
      isPrivate: channelType === "private",
    });

    const parts = messageText.split(/({{userContent}})/);
    components = parts.flatMap(part => {
      if (part === '{{userContent}}') {
        return components;
      }
      return [TextComponent(part)];
    });
    if (chatMessage.sender.id === session.bot.selfId) {
      processedMessage.push(AssistantMessage(...components));
    } else {
      processedMessage.push(UserMessage(...components));
    }
  }
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
        const description = await imageViewer.getImageDescription(src, cacheKey, summary);
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
  return processedMessage;
}

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
      check: "检查无误",
      finalReply: chatMessage.content,
      functions: [],
    });
  } else if (format === "XML") {
    return `<status>success</status><replyTo>${chatMessage.channelId}</replyTo><nextReplyIn>1</nextReplyIn><logic>突然好想说：${chatMessage.content}</logic><reply>${chatMessage.content}</reply><check>检查无误</check><finalReply>${chatMessage.content}</finalReply><functions></functions>`;
  }
}

function convertFormat(input:string, targetFormat:"JSON" | "XML"): string {
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
      if (key === 'functions') {
        // 特殊处理 functions 数组
        obj[key].forEach(func => {
          xml += '<functions>';
          xml += `<name>${func.name}</name>`;
          if (func.params) {
            xml += '<params>';
            for (let param in func.params) {
              xml += `<${param}>${func.params[param]}</${param}>`;
            }
            xml += '</params>';
          }
          xml += '</functions>';
        });
      } else if (Array.isArray(obj[key])) {
        xml += `<${key}>`;
        obj[key].forEach(item => {
          if (typeof item === 'object') {
            xml += json2xml(item);
          } else {
            xml += `<item>${item}</item>`;
          }
        });
        xml += `</${key}>`;
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        xml += `<${key}>${json2xml(obj[key])}</${key}>`;
      } else {
        xml += `<${key}>${obj[key]}</${key}>`;
      }
    }
    return xml;
  }

  // XML 转 JSON
  function xml2json(xmlStr: string) {
    const parser = new XMLParser();
    return parser.parse(xmlStr);
  }

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
