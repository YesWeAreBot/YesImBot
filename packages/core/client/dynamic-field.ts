import { Schema } from "@koishijs/client";
import { computed, defineComponent, h, resolveComponent } from "vue";

export function dynamicField(schemas: () => Record<string, any>) {
    return defineComponent({
        name: "YibDynamicField",
        inheritAttrs: false,
        props: ["schema", "modelValue", "initial", "disabled", "prefix", "extra"],
        emits: ["update:modelValue"],
        setup(props, { emit, attrs, slots }) {
            const inner = computed(() => {
                const live = schemas()?.[props.schema.meta.extra?.name];
                // Live schemas arrive serialized; k-schema reconstructs their reference table.
                if (live) {
                    const hydrated = new Schema(live);
                    if (hydrated.type !== "intersect" || hydrated.list?.length)
                        return { ...hydrated, meta: { ...props.schema.meta, ...hydrated.meta, role: hydrated.meta.role, extra: hydrated.meta.extra } };
                }
                return { ...props.schema, meta: { ...props.schema.meta, role: undefined, extra: undefined } };
            });
            return () =>
                h(
                    resolveComponent("k-schema"),
                    { ...attrs, ...props, schema: inner.value, "onUpdate:modelValue": (value) => emit("update:modelValue", value) },
                    slots,
                );
        },
    });
}
