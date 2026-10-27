import { renderToString } from "@vue/server-renderer";
import { Schema } from "koishi";
import { expect, it } from "vitest";
import { createSSRApp, defineComponent, h } from "vue";

import apply, { ConfigSection } from "../client";

it("registers top-level sections and nested subsections independently", () => {
    const extensions: any[] = [];
    apply({ extendSchema: (extension: unknown) => extensions.push(extension) });
    expect(extensions.map(({ type, role }) => `${type}:${role}`)).toEqual([
        "object:yib-section",
        "intersect:yib-section",
        "object:yib-subsection",
        "intersect:yib-subsection",
    ]);
});

it.each([false, true])("renders a subsection without a duplicate top-level heading (folded=%s)", async (collapsed) => {
    const schema = Schema.object({}).description("模型组").role("yib-subsection").collapse(collapsed);
    const app = createSSRApp({ render: () => h(ConfigSection, { schema, modelValue: {}, prefix: "providers." }) });
    app.component(
        "k-schema",
        defineComponent({
            props: ["schema", "prefix"],
            setup: (props) => () => h("input", { "data-prefix": props.prefix, "data-inner-title": props.schema.meta.description ?? "none" }),
        }),
    );
    const html = await renderToString(app);
    expect(html).toContain('<h3 class="yib-config-section-heading">');
    expect(html).not.toContain("<h2");
    expect(html.match(/模型组/g)).toHaveLength(1);
    expect(html).toContain('data-inner-title="none"');
    expect(html).toContain('data-prefix="providers."');
    expect(html).toContain(`aria-expanded="${!collapsed}"`);
    // Folding keeps the native schema mounted and forwards the same data path.
    expect(html).toContain("<input");
});
