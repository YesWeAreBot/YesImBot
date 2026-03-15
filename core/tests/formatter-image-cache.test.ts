import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", () => {
  type AttrValue = string | number | boolean | undefined;

  const renderTag = (type: string, attrs: Record<string, AttrValue>) => {
    const renderedAttrs = Object.entries(attrs)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}="${String(value)}"`)
      .join(" ");
    return renderedAttrs.length > 0 ? `<${type} ${renderedAttrs}/>` : `<${type}/>`;
  };

  const hImpl = ((type: string, attrs: Record<string, AttrValue> = {}) => ({
    type,
    attrs,
    children: [],
    toString: () => renderTag(type, attrs),
  })) as unknown as typeof import("koishi").h;

  hImpl.escape = (value: string) => value;

  return {
    h: hImpl,
  };
});

import { registerBuiltinHandlers, type ElementHandler } from "../src/services/formatter/handlers";

describe("formatter image cache integration", () => {
  it("uses the resolved cache download id for img tags", async () => {
    const download = vi.fn(async () => "content-image-id");
    const urlToId = vi.fn(() => "url-hash-id");
    const handlers = new Map<string, ElementHandler>();

    registerBuiltinHandlers(
      (type, handler) => {
        handlers.set(type, handler);
      },
      {
        "yesimbot.image-cache": {
          download,
          urlToId,
        },
      } as never,
    );

    const imgHandler = handlers.get("img");
    expect(imgHandler).toBeTypeOf("function");

    const rendered = await imgHandler?.(
      {
        src: "https://example.com/image.png",
        file: "image.png",
      },
      [],
    );

    expect(download).toHaveBeenCalledWith("https://example.com/image.png");
    expect(urlToId).not.toHaveBeenCalled();
    expect(rendered).toContain('id="content-image-id"');
    expect(rendered).not.toContain('id="url-hash-id"');
  });
});
