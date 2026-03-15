import { h } from "koishi";
import type { Context, Element, Session } from "koishi";

export type ElementHandler = (
  attrs: Record<string, unknown>,
  children: Element[],
) => string | Promise<string>;

const QUOTE_PREVIEW_MAX = 80;
const UNVERIFIED_THRESHOLD = 200;

export function registerBuiltinHandlers(
  register: (type: string, handler: ElementHandler) => void,
  ctx: Context,
): void {
  register("at", (attrs) => {
    if (attrs.name != null) attrs.name = h.escape(String(attrs.name), true);
    return h("at", attrs).toString();
  });

  register("face", (attrs) => {
    return h("face", attrs).toString();
  });

  register("img", (attrs) => {
    const src = attrs.src as string | undefined;
    const pureAttrs: Record<string, unknown> = {
      summary: attrs.summary,
      file: attrs.file,
      "sub-type": attrs["sub-type"],
      "file-size": attrs["file-size"],
    };
    if (!src) {
      return h("img", pureAttrs).toString();
    }

    return (async () => {
      const cache = ctx["yesimbot.image-cache"];
      if (cache) {
        const id = await cache.download(src);
        pureAttrs["id"] = id;
      }
      return h("img", pureAttrs).toString();
    })();
  });

  register("audio", (attrs) => {
    return h("audio", attrs).toString();
  });

  register("video", (attrs) => {
    return h("video", attrs).toString();
  });

  register("file", (attrs) => {
    return h("file", attrs).toString();
  });

  register("forward", (attrs) => {
    return h("forward", attrs).toString();
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
