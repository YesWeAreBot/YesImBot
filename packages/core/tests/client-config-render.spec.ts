import { renderToString } from "@vue/server-renderer";
import { describe, expect, it, vi } from "vitest";
import { createSSRApp, defineComponent, h, reactive, type VNode } from "vue";

import { PurposeConfig } from "../client";
import { SearchEngineSelection } from "../client/search-engine-selection";

vi.mock("@koishijs/client", () => ({ store: {}, Schema: class {} }));

describe("console configuration controls", () => {
    it("renders standalone settings directly with the native form editor", async () => {
        const toggle = { type: "boolean", meta: {} };
        const l2 = { type: "object", meta: {}, dict: { enabled: toggle } };
        const schema = { type: "object", meta: {}, dict: { ignoreSelfMessage: toggle, nativeToolCalling: toggle, l2_memory: l2 } };
        const app = createSSRApp({ render: () => h(PurposeConfig, { schema, modelValue: {} }) });
        app.component(
            "k-schema",
            defineComponent({
                props: ["schema", "prefix"],
                setup: (props) => () => h("span", { "data-native-type": props.schema.type, "data-path": props.prefix }),
            }),
        );
        const html = await renderToString(app);
        expect(html).toContain('class="yib-config-direct"');
        expect(html).toContain('data-native-type="boolean" data-path="ignoreSelfMessage."');
        expect(html).toContain('data-native-type="boolean" data-path="nativeToolCalling."');
        expect(html).not.toContain("本轮上下文");
        expect(html).not.toContain("工具调用与单轮执行");
        expect(html).toContain("语义记忆检索");
    });

    it("tracks IDs added to the local draft and allows a deleted selection to be cleared", () => {
        const props = reactive({
            engines: [{ id: "configured-engine", backend: "brave" }],
            modelValue: ["configured-engine"],
            disabled: false,
        });
        const update = vi.fn<(event: string, value: string[]) => void>((_event, value) => {
            props.modelValue = value;
        });
        const render = (SearchEngineSelection.setup as unknown as (props: unknown, ctx: { emit: typeof update }) => () => VNode)(props, {
            emit: update,
        });
        const options = () => (render().children as VNode[]).filter((node) => node.type === "label");
        expect(options().map((node) => node.key)).toEqual(["configured-engine"]);
        props.engines.push({ id: "new-draft", backend: "exa" });
        const newDraft = options().find((node) => node.key === "new-draft")!;
        const [input] = newDraft.children as VNode[];
        expect(input.props?.checked).toBe(false);
        input.props?.onChange({ target: { checked: true } });
        expect(props.modelValue).toEqual(["configured-engine", "new-draft"]);
        props.engines = [];
        expect(options().map((node) => node.key)).toEqual(["configured-engine", "new-draft"]);
        for (const node of options()) (node.children as VNode[])[0].props?.onChange({ target: { checked: false } });
        expect(props.modelValue).toEqual([]);
    });
});
