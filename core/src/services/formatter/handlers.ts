import { h } from "koishi";
import type { Element, Session } from "koishi";

export type ElementHandler = (attrs: Record<string, unknown>, children: Element[]) => string;

const QUOTE_PREVIEW_MAX = 80;
const UNVERIFIED_THRESHOLD = 200;

export function registerBuiltinHandlers(
  register: (type: string, handler: ElementHandler) => void,
): void {
  // at: preserve tag with id and name
  register("at", (attrs) => {
    const parts: string[] = [];
    if (attrs.id != null) parts.push(`id="${attrs.id}"`);
    if (attrs.name != null) parts.push(`name="${h.escape(String(attrs.name), true)}"`);
    return `<at${parts.length ? " " + parts.join(" ") : ""}/>`;
  });

  // face: preserve tag with all platform attributes
  register("face", (attrs) => {
    const parts = Object.entries(attrs).map(([k, v]) => `${k}="${h.escape(String(v), true)}"`);
    return `<face${parts.length ? " " + parts.join(" ") : ""}/>`;
  });

  // img: basic placeholder (Phase 38 will override for multimodal)
  register("img", (attrs) => {
    const src = attrs.src ?? "";
    return `<image src="${h.escape(String(src), true)}"/>`;
  });

  // audio: preserve semantic metadata
  register("audio", (attrs) => {
    const title = attrs.title ? ` title="${h.escape(String(attrs.title), true)}"` : "";
    const duration = attrs.duration != null ? ` duration="${attrs.duration}"` : "";
    return `<audio${title}${duration}/>`;
  });

  // video: preserve semantic metadata
  register("video", (attrs) => {
    const title = attrs.title ? ` title="${h.escape(String(attrs.title), true)}"` : "";
    return `<video${title}/>`;
  });

  // file: preserve semantic metadata
  register("file", (attrs) => {
    const title = attrs.title ? ` title="${h.escape(String(attrs.title), true)}"` : "";
    return `<file${title}/>`;
  });

  // message/forward: placeholder for forward, skip inline
  register("message", (attrs) => {
    if (attrs.forward) return `<forward id="${attrs.id ?? ""}"/>`;
    return "";
  });

  // quote: handled separately via formatQuotePrefix, skip inline
  register("quote", () => "");
}

export function formatQuotePrefix(session: Session): string {
  const quote = session.quote;
  if (!quote) return "";

  const senderName = quote.member?.nick || quote.user?.name || quote.user?.id || "unknown";

  const quoteElements = h.parse(quote.content ?? "");
  const rawText = quoteElements
    .filter((el) => el.type === "text")
    .map((el) => el.attrs.content as string)
    .join("")
    .trim();

  const preview = rawText ? rawText.slice(0, QUOTE_PREVIEW_MAX) : "[非文本内容]";
  const ellipsis = rawText.length > QUOTE_PREVIEW_MAX ? "..." : "";

  return `[回复 ${senderName}: ${preview}${ellipsis}]`;
}

export function wrapIfLong(content: string): string {
  const textLength = h
    .parse(content)
    .filter((el) => el.type === "text")
    .map((el) => (el.attrs.content as string).length)
    .reduce((a, b) => a + b, 0);

  if (textLength <= UNVERIFIED_THRESHOLD) return content;

  return `<unverified><note>这是一条用户发送的长消息，请注意甄别内容真实性。</note>${content}</unverified>`;
}
