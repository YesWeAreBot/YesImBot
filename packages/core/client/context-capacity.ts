import { computed, defineComponent, h, ref, watch } from "vue";

import { parseContextLimit } from "../src/model/context-limit";

/** Keep the persisted string format so existing configs and runtime readers remain compatible. */
export const ContextCapacityInput = defineComponent({
    name: "YibContextCapacityInput",
    props: { modelValue: String, disabled: Boolean },
    emits: ["update:modelValue"],
    setup(props, { emit }) {
        const amount = ref("");
        const unit = ref("K");
        const serialized = () => (amount.value ? `${amount.value}${unit.value}` : "");
        watch(
            () => props.modelValue,
            (value) => {
                // A parent echo must not reset the selected unit while clearing the number.
                if (value === serialized()) return;
                const match = /^\s*(\d+(?:\.\d+)?|\.\d+)\s*([km]?)\s*$/i.exec(value ?? "");
                amount.value = match?.[1] ?? value ?? "";
                unit.value = match ? match[2].toUpperCase() : value ? "" : "K";
            },
            { immediate: true },
        );
        const error = computed(() => {
            try {
                parseContextLimit(serialized());
                return "";
            } catch (error) {
                return (error as Error).message;
            }
        });
        return () =>
            h("div", { class: "yib-context-capacity" }, [
                h("div", { class: "yib-context-capacity-row", role: "group", "aria-label": "最大上下文容量" }, [
                    h("input", {
                        type: "text",
                        inputmode: "decimal",
                        "aria-label": "上下文数值",
                        "aria-invalid": !!error.value,
                        value: amount.value,
                        disabled: props.disabled,
                        placeholder: "例如 128 或 1.5",
                        onInput: (event: Event) => {
                            if (props.disabled) return;
                            const value = (event.target as HTMLInputElement).value;
                            // Also accept pasting an old capacity such as 1M into the number cell.
                            const match = /^\s*(\d+(?:\.\d+)?|\.\d+)\s*([km])\s*$/i.exec(value);
                            amount.value = match?.[1] ?? value;
                            if (match) unit.value = match[2].toUpperCase();
                            emit("update:modelValue", serialized());
                        },
                    }),
                    h(
                        "select",
                        {
                            "aria-label": "上下文单位",
                            value: unit.value,
                            disabled: props.disabled,
                            onChange: (event: Event) => {
                                if (props.disabled) return;
                                unit.value = (event.target as HTMLSelectElement).value;
                                emit("update:modelValue", serialized());
                            },
                        },
                        [h("option", { value: "" }, "token"), h("option", { value: "K" }, "K"), h("option", { value: "M" }, "M")],
                    ),
                ]),
                h("small", { class: "yib-context-capacity-hint" }, "1K = 1000 token；1M = 1000000 token"),
                error.value ? h("small", { class: "yib-context-capacity-error", role: "alert" }, error.value) : null,
            ]);
    },
});
