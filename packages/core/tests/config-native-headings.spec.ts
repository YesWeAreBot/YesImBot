import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderToString } from "@vue/server-renderer";
import { Schema } from "koishi";
import { expect, it, vi } from "vitest";
import { createSSRApp, h } from "vue";
import { createI18n } from "vue-i18n";
vi.mock("@koishijs/client", async () => ({ store: { schema: {} }, Schema: (await import("koishi")).Schema }));
import apply from "../client";
import { Config } from "../src/config/config";
import { modelSelector } from "../src/shared/config-selectors";

const assertTitles = (html: string) => {
    const headings = [...html.matchAll(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/g)].map((match) => match[1].replace(/<[^>]*>/g, ""));
    for (const section of Config.list!.filter((item) => item.meta.role === "yib-section"))
        expect(headings.filter((text) => text.startsWith(String(section.meta.description)))).toHaveLength(1);
};

it("renders serialized configuration before and after client extension registration without duplicate headings", async () => {
    const require = createRequire(import.meta.url);
    const clientRequire = createRequire(require.resolve("@koishijs/client/lib"));
    const { createServer } = clientRequire("vite");
    const vue = clientRequire("@vitejs/plugin-vue");
    const yaml = clientRequire("@maikolib/vite-plugin-yaml");
    const server = await createServer({
        root: fileURLToPath(new URL("../../..", import.meta.url)),
        configFile: false,
        plugins: [(vue.default ?? vue)(), (yaml.default ?? yaml)()],
        server: { middlewareMode: true, hmr: false },
        optimizeDeps: { noDiscovery: true },
    });
    try {
        const schemaRoot = path.dirname(require.resolve("schemastery-vue"));
        const { form } = await server.ssrLoadModule(require.resolve("schemastery-vue"));
        const files = [schemaRoot, path.join(schemaRoot, "extensions")].flatMap((dir) =>
            readdirSync(dir)
                .filter((file) => file.endsWith(".vue"))
                .map((file) => path.join(dir, file)),
        );
        const tags = new Set(files.flatMap((file) => [...readFileSync(file, "utf8").matchAll(/<(el-[\w-]+)/g)].map((match) => match[1])));
        const render = async (schema, modelValue, full = true) => {
            const app = createSSRApp({
                render: () => h(full ? form.Form : form.Schema, { schema: new Schema(JSON.parse(JSON.stringify(schema))), modelValue }),
            });
            app.use(form);
            app.use(createI18n({ legacy: false, locale: "zh-CN", messages: { "zh-CN": {} } }));
            app.component("k-markdown", {
                props: ["source"],
                render() {
                    return h("p", this.source);
                },
            });
            for (const name of tags)
                app.component(name, {
                    setup:
                        (_props, { slots }) =>
                        () =>
                            h("div", slots.default?.()),
                });
            return renderToString(app);
        };

        assertTitles(await render(Config, {}));
        const offline = await render(modelSelector("unregistered-models"), undefined, false);
        expect(offline).toContain("providerName");
        expect(offline).toContain("modelId");
        apply({ schema: (extension) => form.extensions.add(extension) });
        const mounted = await render(Config, { providers: [{ name: "", models: [] }] });
        assertTitles(mounted);
        expect(mounted).toContain('aria-invalid="true"');
        expect(mounted).toContain("配置未完成或无效");
        expect(mounted).toContain("此项配置未完成或无效");
    } finally {
        await server.close();
    }
});
