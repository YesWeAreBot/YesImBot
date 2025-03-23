import { h, Session, Element } from 'koishi';
import { XMLParser } from "fast-xml-parser";

import { Config } from '../config';
import { ChatMessage, getChannelType } from '../models/ChatMessage';
import { isEmpty, Template } from './string';
import { getFileUnique, getMemberName, getFormatDateTime } from './toolkit';
import { ImageViewer } from '../services/imageViewer';
import { Message, UserMessage } from "../adapters/creators/component";


/**
 * 处理用户消息
 * @param config
 * @param session
 * @param messages
 * @returns
 */
export async function processContent(config: Config, session: Session, messages: ChatMessage[], imageViewer: ImageViewer): Promise<Message[]> {
  const processedMessage: Message[] = [];

  for (let chatMessage of messages) {
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
          // 不转义，让LLM自己生成quote标签来使用引用功能
          userContent.push(`<quote id='${elem.attrs.quoteMessageId || elem.attrs.id || '未知'}'/>`);
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
      isPrivate: channelType === "private",
    });
    messageText = `${chatMessage.sender.id === session.bot.selfId ? "[assistant] " : "[user] "}${messageText}`;
    processedMessage.push(UserMessage(messageText));
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
