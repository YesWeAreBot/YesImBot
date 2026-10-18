import { expect, test } from "vitest";
import { createRenderer, h, nextTick, ref } from "vue";

import { ContextCapacityInput } from "../client/context-capacity";
import { ModelConfigSchema } from "../src/model/config";
import { parseContextLimit } from "../src/model/context-limit";

// Render the actual Vue input without a browser or Koishi server.
function mount(value?: string, disabled = false) {
    const renderer = createRenderer<any, any>({
        createElement: (type) => ({ type, props: {}, children: [] }),
        createText: (text) => ({ text }),
        createComment: (text) => ({ text }),
        setText: (node, text) => (node.text = text),
        setElementText: (node, text) => (node.text = text),
        parentNode: (node) => node.parent,
        nextSibling: () => null,
        patchProp: (node, key, _previous, value) => (node.props[key] = value),
        insert: (node, parent) => {
            node.parent = parent;
            parent.children.push(node);
        },
        remove: (node) => {
            node.parent.children = node.parent.children.filter((child) => child !== node);
        },
    });
    const model = ref(value);
    const root = { children: [] as any[] };
    const app = renderer.createApp({
        render: () => h(ContextCapacityInput, { modelValue: model.value, disabled, "onUpdate:modelValue": (next) => (model.value = next) }),
    });
    app.mount(root);
    return {
        model,
        input: () => root.children[0].children[0].children[0],
        select: () => root.children[0].children[0].children[1],
        errors: () => root.children[0].children.filter((node) => node.props?.role === "alert"),
        dispose: () => app.unmount(),
    };
}

test("legacy capacities populate two cells without rewriting saved values", () => {
    for (const [value, number, unit] of [
        ["1M", "1", "M"],
        [" .5 k ", ".5", "K"],
        ["131072.5", "131072.5", ""],
    ]) {
        const field = mount(value);
        try {
            expect(field.input().props.value).toBe(number);
            expect(field.select().props.value).toBe(unit);
            expect(field.model.value).toBe(value);
            expect(field.errors()).toHaveLength(0);
        } finally {
            field.dispose();
        }
    }
});

test("number and unit edits survive parent echoes, clearing, and config validation", async () => {
    const field = mount("1M");
    try {
        field.input().props.onInput({ target: { value: "1.5" } });
        await nextTick();
        expect(field.model.value).toBe("1.5M");
        expect(parseContextLimit(ModelConfigSchema({ modelId: "m", contextLimit: { mode: "custom", value: field.model.value } }).contextLimit!.value!)).toBe(
            1500000,
        );
        field.select().props.onChange({ target: { value: "K" } });
        await nextTick();
        expect(field.model.value).toBe("1.5K");
        field.input().props.onInput({ target: { value: "" } });
        await nextTick();
        expect(field.errors()).toHaveLength(1);
        expect(field.select().props.value).toBe("K");
        field.input().props.onInput({ target: { value: "128" } });
        await nextTick();
        expect(field.model.value).toBe("128K");
        expect(field.errors()).toHaveLength(0);
        field.model.value = "2M";
        await nextTick();
        expect(field.input().props.value).toBe("2");
        expect(field.select().props.value).toBe("M");
    } finally {
        field.dispose();
    }
});

test("pasted units work, invalid drafts stay visible, and disabled controls cannot edit", async () => {
    const field = mount();
    try {
        field.input().props.onInput({ target: { value: "1M" } });
        await nextTick();
        expect(field.input().props.value).toBe("1");
        expect(field.select().props.value).toBe("M");
        for (const value of ["0", "-1", "Infinity", "1G", "9007199254740992"]) {
            field.input().props.onInput({ target: { value } });
            await nextTick();
            expect(field.input().props.value).toBe(value);
            expect(field.errors()).toHaveLength(1);
            expect(() => ModelConfigSchema({ modelId: "m", contextLimit: { mode: "custom", value: field.model.value } })).toThrow(/contextLimit|最大上下文/);
        }
    } finally {
        field.dispose();
    }
    const locked = mount("1M", true);
    try {
        expect(locked.input().props.disabled).toBe(true);
        expect(locked.select().props.disabled).toBe(true);
        locked.input().props.onInput({ target: { value: "2" } });
        locked.select().props.onChange({ target: { value: "K" } });
        expect(locked.model.value).toBe("1M");
    } finally {
        locked.dispose();
    }
});
