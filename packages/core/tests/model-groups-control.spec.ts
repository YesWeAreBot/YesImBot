import { Schema } from "koishi";
import { expect, it } from "vitest";
import { createRenderer, defineComponent, h, nextTick, ref } from "vue";

import { ModelGroups } from "../client/model-groups";

type Node = { type: string; props: Record<string, any>; children: Node[]; parent?: Node; text?: string };
const node = (type: string): Node => ({ type, props: {}, children: [] });

function mount(disabled = false) {
    const renderer = createRenderer<Node, Node>({
        createElement: node,
        createText: (text) => ({ ...node("text"), text }),
        createComment: (text) => ({ ...node("comment"), text }),
        setText: (element, text) => {
            element.text = text;
        },
        setElementText: (element, text) => {
            element.text = text;
            element.children = [];
        },
        parentNode: (element) => element.parent!,
        nextSibling: (element) => element.parent?.children[element.parent.children.indexOf(element) + 1] ?? null,
        patchProp: (element, key, _before, after) => {
            element.props[key] = after;
        },
        insert: (element, parent, anchor) => {
            if (element.parent) element.parent.children.splice(element.parent.children.indexOf(element), 1);
            element.parent = parent;
            const index = anchor ? parent.children.indexOf(anchor) : -1;
            parent.children.splice(index < 0 ? parent.children.length : index, 0, element);
        },
        remove: (element) => {
            element.parent?.children.splice(element.parent.children.indexOf(element), 1);
        },
    });
    const original = [
        { name: "A", models: [{ providerName: "p", modelId: "m" }] },
        { name: "B", models: [] },
    ];
    const value = ref(structuredClone(original));
    const updates: any[] = [];
    const root = node("root");
    const app = renderer.createApp({
        render: () =>
            h(ModelGroups, {
                schema: Schema.array(Schema.object({ name: Schema.string() })),
                prefix: "modelGroups.",
                modelValue: value.value,
                disabled,
                "onUpdate:modelValue": (next) => {
                    updates.push(next);
                    value.value = next;
                },
            }),
    });
    app.component(
        "k-schema",
        defineComponent({
            props: ["prefix", "modelValue"],
            setup: (props) => () => h("input", { "data-prefix": props.prefix, value: props.modelValue?.name }),
        }),
    );
    app.mount(root);
    const all = (parent = root): Node[] => [parent, ...parent.children.flatMap((child) => all(child))];
    return { value, updates, original, all, app };
}
it("deletes the selected group, reindexes native controls, and can delete the final group", async () => {
    const f = mount();
    f.all()
        .find((element) => element.props["aria-label"] === "删除模型组 1")!
        .props.onClick();
    await nextTick();
    expect(f.value.value.map((row) => row.name)).toEqual(["B"]);
    expect(f.original).toHaveLength(2);
    expect(f.all().find((element) => element.type === "input")!.props["data-prefix"]).toBe("modelGroups[0].");
    f.all()
        .find((element) => element.props["aria-label"] === "删除模型组 1")!
        .props.onClick();
    await nextTick();
    expect(f.value.value).toEqual([]);
    expect(f.all().some((element) => element.text?.includes("自动创建默认模型组"))).toBe(true);
    f.app.unmount();
});
it("keeps deletion inert when the configuration is disabled", () => {
    const f = mount(true);
    const button = f.all().find((element) => element.props["aria-label"] === "删除模型组 1")!;
    expect(button.props.disabled).toBe(true);
    button.props.onClick();
    expect(f.updates).toEqual([]);
    f.app.unmount();
});
it("supports moving entries without changing their contents", async () => {
    const f = mount();
    f.all()
        .find((element) => element.props["aria-label"] === "下移模型组 1")!
        .props.onClick();
    await nextTick();
    expect(f.value.value.map((row) => row.name)).toEqual(["B", "A"]);
    expect(f.value.value[1].models).toEqual(f.original[0].models);
    f.app.unmount();
});
