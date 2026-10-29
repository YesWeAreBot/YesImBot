import { store } from "@koishijs/client";
import { computed, defineComponent, h, ref, resolveComponent } from "vue";

import { dynamicField } from "./dynamic-field";

import "./section.css";
import { invalidConfig } from "./validation";

let nextSectionId = 0;

// Koishi passes foldable=false to intersect members. Give marked top-level
// sections their own boundary without changing their config keys or controls.
export const ConfigSection = defineComponent({
    name: "YibConfigSection",
    inheritAttrs: false,
    props: ["schema", "modelValue", "initial", "disabled", "prefix", "extra"],
    emits: ["update:modelValue"],
    setup(props, { emit, attrs }) {
        const collapsed = ref(!!props.schema.meta.collapse);
        const bodyId = `yib-config-section-${++nextSectionId}`;
        const inner = computed(() => {
            const { role: _role, description: _description, collapse: _collapse, ...meta } = props.schema.meta;
            return { ...props.schema, meta };
        });
        const invalid = computed(() => !!props.extra?.invalid || invalidConfig(inner.value, props.modelValue));
        return () =>
            h(
                "section",
                {
                    ...attrs,
                    class: [
                        "yib-config-section",
                        props.schema.meta.role === "yib-subsection" && "yib-config-subsection",
                        attrs.class,
                        { invalid: invalid.value },
                    ],
                },
                [
                    h(props.schema.meta.role === "yib-subsection" ? "h3" : "h2", { class: "yib-config-section-heading" }, [
                        h(
                            "button",
                            {
                                type: "button",
                                "aria-expanded": !collapsed.value,
                                "aria-controls": bodyId,
                                "aria-invalid": invalid.value,
                                onClick: () => (collapsed.value = !collapsed.value),
                            },
                            [
                                h("span", props.schema.meta.description),
                                invalid.value ? h("span", { class: "yib-config-section-error" }, "配置未完成或无效") : null,
                                h("span", { class: "yib-config-section-toggle" }, collapsed.value ? "展开" : "收起"),
                            ],
                        ),
                    ]),
                    // Keep native children mounted: folding must not discard drafts.
                    h("div", { id: bodyId, class: "yib-config-section-body", hidden: collapsed.value }, [
                        h(resolveComponent("k-schema"), {
                            schema: inner.value,
                            modelValue: props.modelValue,
                            initial: props.initial,
                            disabled: props.disabled,
                            prefix: props.prefix,
                            extra: { ...props.extra, foldable: false },
                            "onUpdate:modelValue": (value) => emit("update:modelValue", value),
                        }),
                    ]),
                ],
            );
    },
});

export const ConfigEntry = defineComponent({
    name: "YibConfigEntry",
    inheritAttrs: false,
    props: ["schema", "modelValue", "initial", "disabled", "prefix", "extra"],
    emits: ["update:modelValue"],
    setup(props, { emit, attrs, slots }) {
        const inner = computed(() => ({ ...props.schema, meta: { ...props.schema.meta, role: undefined } }));
        const invalid = computed(() => !!props.extra?.invalid || invalidConfig(inner.value, props.modelValue));
        return () =>
            h("div", { ...attrs, class: ["yib-config-entry", attrs.class, { invalid: invalid.value }] }, [
                h(
                    resolveComponent("k-schema"),
                    {
                        ...props,
                        schema: inner.value,
                        extra: { ...props.extra, invalid: invalid.value },
                        "onUpdate:modelValue": (value) => emit("update:modelValue", value),
                    },
                    slots,
                ),
                invalid.value ? h("p", { class: "yib-config-entry-error", role: "status" }, "此项配置未完成或无效，请展开检查。") : null,
            ]);
    },
});

export default function apply(ctx) {
    for (const type of ["object", "intersect"]) ctx.schema({ type, role: "yib-entry", component: ConfigEntry });
    const component = dynamicField(() => store.schema ?? {});
    for (const type of ["union", "string", "array", "dict"]) ctx.schema({ type, role: "yib-dynamic", component });
    for (const role of ["yib-section", "yib-subsection"]) {
        for (const type of ["object", "intersect"]) ctx.schema({ type, role, component: ConfigSection });
    }
}
