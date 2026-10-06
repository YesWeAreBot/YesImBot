import { computed, defineComponent, h, ref, resolveComponent } from "vue";
import "./section.css";

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
            const { role, description, collapse, ...meta } = props.schema.meta;
            return { ...props.schema, meta };
        });
        return () => h("section", { ...attrs, class: ["yib-config-section", attrs.class] }, [
            h("h2", { class: "yib-config-section-heading" }, [
                h("button", {
                    type: "button",
                    "aria-expanded": !collapsed.value,
                    "aria-controls": bodyId,
                    onClick: () => collapsed.value = !collapsed.value,
                }, [
                    h("span", props.schema.meta.description),
                    h("span", { class: "yib-config-section-toggle" }, collapsed.value ? "展开" : "收起"),
                ]),
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
                    "onUpdate:modelValue": value => emit("update:modelValue", value),
                }),
            ]),
        ]);
    },
});

export default function apply(ctx) {
    for (const type of ["object", "intersect"]) {
        ctx.extendSchema({ type, role: "yib-section", component: ConfigSection });
    }
}
