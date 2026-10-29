import { renderToString } from "@vue/server-renderer";
import { Schema } from "koishi";
import { expect, it, vi } from "vitest";
import { createSSRApp, defineComponent, h } from "vue";
vi.mock("@koishijs/client", async () => ({ store: { schema: {} }, Schema: (await import("koishi")).Schema }));
import { ConfigSection } from "../client";
import { dynamicField } from "../client/dynamic-field";
import { invalidConfig } from "../client/validation";
import { modelSelector, groupSelector, backgroundToolSelector } from "../src/shared/config-selectors";

it("keeps static model, group and tool controls available without a running instance", () => {
    const model = modelSelector("models");
    expect(model.list![0].dict!.providerName.type).toBe("string");
    expect(model.list![0].dict!.modelId.type).toBe("string");
    expect(model(undefined)).toBeUndefined();
    expect(model({ providerName: "p", modelId: "m" })).toEqual({ providerName: "p", modelId: "m" });
    expect(groupSelector().type).toBe("string");
    expect(backgroundToolSelector().inner!.type).toBe("string");
});
it("marks required entries in nested arrays without rejecting optional selectors", () => {
    const schema = Schema.object({
        providers: Schema.array(Schema.object({ name: Schema.string().required(), models: Schema.array(Schema.string()).required() })),
        optional: modelSelector("models"),
    });
    expect(invalidConfig(schema, { providers: [{ name: "", models: [] }] })).toBe(true);
    expect(invalidConfig(schema, { providers: [{ name: "p", models: ["m"] }] })).toBe(false);
});
it("keeps collapsed parent and child sections marked invalid", async () => {
    const child = Schema.object({ name: Schema.string().required() }).description("child").role("yib-subsection").collapse();
    const parent = Schema.intersect([child]).description("parent").role("yib-section").collapse();
    const app = createSSRApp({ render: () => h(ConfigSection, { schema: parent, modelValue: {} }) });
    app.component(
        "k-schema",
        defineComponent({
            props: ["schema", "modelValue"],
            setup: (props) => () => (props.schema.type === "intersect" ? h(ConfigSection, { schema: child, modelValue: props.modelValue }) : h("input")),
        }),
    );
    const html = await renderToString(app);
    expect(html.match(/aria-invalid="true"/g)).toHaveLength(2);
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(2);
    expect(html.match(/配置未完成或无效/g)).toHaveLength(2);
});
it.each([false, true])("renders static fallback or hydrated live controls (live=%s)", async (live) => {
    const schema = groupSelector().description("选择模型组");
    const component = dynamicField(() => (live ? { "modelService.availableGroups": JSON.parse(JSON.stringify(Schema.union(["a", "b"]))) } : {}));
    const app = createSSRApp({ render: () => h(component, { schema, modelValue: "a", prefix: "task.chat." }) });
    app.component(
        "k-schema",
        defineComponent({
            props: ["schema", "prefix"],
            setup: (props) => () => h("input", { "data-type": props.schema.type, "data-role": props.schema.meta.role ?? "", "data-prefix": props.prefix }),
        }),
    );
    const html = await renderToString(app);
    expect(html).toContain(`data-type="${live ? "union" : "string"}"`);
    expect(html).not.toContain("yib-dynamic");
    expect(html).toContain('data-prefix="task.chat."');
});

it("marks an unconfigured provider list without changing backend defaults", () => {
    const schema = Schema.object({ providers: Schema.array(Schema.object({ name: Schema.string() })) });
    expect(invalidConfig(schema, {})).toBe(true);
    expect(invalidConfig(schema, { providers: [] })).toBe(true);
    expect(invalidConfig(schema, { providers: [{ name: "p" }] })).toBe(false);
});

it("only requires an optional evaluator after its feature is enabled", () => {
    const schema = Schema.object({ mode: Schema.union(["off", "observe", "adjust"]).default("off"), evaluationModel: modelSelector("models") });
    expect(invalidConfig(schema, { mode: "off" })).toBe(false);
    expect(invalidConfig(schema, { mode: "observe" })).toBe(true);
    expect(invalidConfig(schema, { mode: "observe", evaluationModel: { providerName: "p", modelId: "m" } })).toBe(false);
});

it("marks the model group card when a required child is missing", async () => {
    const { ModelGroups } = await import("../client/model-groups");
    const schema = Schema.array(Schema.object({ name: Schema.string().required(), models: Schema.array(Schema.string()).required() }));
    const app = createSSRApp({ render: () => h(ModelGroups, { schema, modelValue: [{ name: "", models: [] }] }) });
    app.component("k-schema", { render: () => h("input") });
    const html = await renderToString(app);
    expect(html).toContain('class="yib-model-group-row invalid"');
    expect(html).toContain('aria-invalid="true"');
});
