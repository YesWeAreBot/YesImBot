import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderToString } from "@vue/server-renderer";
import { expect, it } from "vitest";
import { createSSRApp, defineComponent, h } from "vue";
import { createI18n } from "vue-i18n";

import { Config } from "../src/config/config";

it("renders each main heading once through the native Koishi fallback", async () => {
    const require = createRequire(import.meta.url);
    const clientRequire = createRequire(require.resolve("@koishijs/client/lib"));
    const { createServer, normalizePath } = clientRequire("vite");
    const vue = clientRequire("@vitejs/plugin-vue");
    const yaml = clientRequire("@maikolib/vite-plugin-yaml");
    const root = fileURLToPath(new URL("../../..", import.meta.url));
    const server = await createServer({
        root,
        configFile: false,
        plugins: [(vue.default ?? vue)(), (yaml.default ?? yaml)()],
        server: { middlewareMode: true },
        optimizeDeps: { noDiscovery: true },
    });
    try {
        const schemaRoot = path.dirname(require.resolve("schemastery-vue"));
        const object = (await server.ssrLoadModule(normalizePath(path.join(schemaRoot, "extensions/object.vue")))).default;
        const intersect = (await server.ssrLoadModule(normalizePath(path.join(schemaRoot, "extensions/intersect.vue")))).default;
        const NativeSchema = defineComponent({
            props: ["schema", "modelValue", "extra", "prefix", "initial", "disabled"],
            setup: (props) => () =>
                ["object", "intersect"].includes(props.schema.type)
                    ? h(props.schema.type === "object" ? object : intersect, props)
                    : h("input", { "data-prefix": props.prefix }),
        });
        const app = createSSRApp({ render: () => h(NativeSchema, { schema: Config, modelValue: {}, prefix: "", extra: { foldable: false } }) });
        app.use(createI18n({ legacy: false, locale: "zh-CN", messages: { "zh-CN": {} } }));
        app.component("k-schema", NativeSchema);
        app.component("k-badge", {
            setup:
                (_props, { slots }) =>
                () =>
                    h("span", slots.default?.()),
        });
        app.component("k-markdown", {
            props: ["source"],
            render() {
                return h("p", this.source);
            },
        });
        for (const name of ["el-button", "el-tooltip", "el-collapse-transition"])
            app.component(name, {
                setup:
                    (_props, { slots }) =>
                    () =>
                        h("div", slots.default?.()),
            });
        const html = await renderToString(app);
        const headings = Config.list!.filter((section) => section.meta.role === "yib-section").map((section) => section.meta.description);
        for (const title of headings) expect(html.split(String(title))).toHaveLength(2);
        expect(html.split("日志设置")).toHaveLength(2);
        expect(html).toContain('data-prefix="logging.local.enabled."');
    } finally {
        await server.close();
    }
});
