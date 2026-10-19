import { h } from "koishi";
import { expect, it, vi, type TestContext } from "vitest";

import CodeToImage from "../src";

async function fixture(t: TestContext) {
    const hooks: Record<string, Array<() => unknown>> = {};
    const command = {
        usage() {
            return this;
        },
        option() {
            return this;
        },
        action() {
            return this;
        },
    };
    const rendered: string[] = [];
    const container = {};
    const render = vi.fn<(html: string, callback: Function) => Promise<string>>(async (html, callback) => {
        rendered.push(html);
        return callback({ $: async () => container }, async () => h.image(Buffer.from("png"), "image/png").toString());
    });
    const ctx: any = {
        logger: () => ({ info() {}, warn() {} }),
        on(event: string, callback: () => unknown) {
            (hooks[event] ??= []).push(callback);
        },
        command: () => command,
        puppeteer: { render },
        yesimbot: { tool: { register() {}, unregister() {} } },
    };
    const plugin = new CodeToImage(ctx, {
        fontDirectory: "",
        defaultTheme: "github-light",
        defaultFontFamily: "monospace",
        defaultFontSize: 18,
        defaultPadding: 40,
    });
    t.onTestFinished(async () => {
        for (const dispose of hooks.dispose) await dispose();
    });
    for (const ready of hooks.ready) await ready();
    const tool = (plugin as any).tools.get("send_code_image");
    const sent: unknown[] = [];
    const session = {
        async send(message: unknown) {
            sent.push(message);
            return ["message"];
        },
    };
    return { render, rendered, sent, execute: (args: object) => tool.execute({ ...tool.parameters(args), session }) };
}

it.for([undefined, "plaintext", "text", "txt", "plain"])("renders the real Shiki plain-text language %s", async (lang, t) => {
    const f = await fixture(t);
    const result = await f.execute({ code: "<hello>", ...(lang === undefined ? {} : { lang }) });
    expect(result.status).toBe("success");
    expect(f.render).toHaveBeenCalledTimes(1);
    expect(f.rendered[0]).toMatch(/(?:&lt;|&#x3c;|&#60;)hello(?:&gt;|>)/i);
    expect(f.rendered[0]).not.toContain("<hello>");
    expect(f.sent).toHaveLength(1);
});

it("loads and renders a real language that was not preloaded", async (t) => {
    const f = await fixture(t);
    const result = await f.execute({ code: "print('hello')", lang: "python" });
    expect(result.status).toBe("success");
    expect(f.rendered[0]).toContain('class="shiki');
    expect(f.render).toHaveBeenCalledTimes(1);
    expect(f.sent).toHaveLength(1);
});

it("rejects an unsupported language before rendering", async (t) => {
    const f = await fixture(t);
    const result = await f.execute({ code: "hello", lang: "not-a-shiki-language" });
    expect(result.status).toBe("error");
    expect(f.render).not.toHaveBeenCalled();
    expect(f.sent).toEqual([]);
});
