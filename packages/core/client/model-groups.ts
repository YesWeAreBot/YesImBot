import { defineComponent, h, ref, resolveComponent, watch } from "vue";

const copy = (value: unknown): any[] => JSON.parse(JSON.stringify(value ?? []));

export const ModelGroups = defineComponent({
    name: "YibModelGroups",
    inheritAttrs: false,
    props: ["schema", "modelValue", "initial", "disabled", "prefix", "extra"],
    emits: ["update:modelValue"],
    setup(props, { emit, attrs, slots }) {
        const rows = ref(copy(props.modelValue));
        watch(
            () => props.modelValue,
            (value) => {
                if (JSON.stringify(value ?? []) !== JSON.stringify(rows.value)) rows.value = copy(value);
            },
            { deep: true },
        );
        const update = () => emit("update:modelValue", copy(rows.value));
        const remove = (index: number) => {
            if (props.disabled) return;
            rows.value.splice(index, 1);
            update();
        };
        const move = (index: number, offset: number) => {
            const destination = index + offset;
            if (props.disabled || destination < 0 || destination >= rows.value.length) return;
            rows.value.splice(destination, 0, ...rows.value.splice(index, 1));
            update();
        };
        return () =>
            h("div", { ...attrs, class: ["yib-model-groups", attrs.class] }, [
                slots.title ? h("div", { class: "yib-model-group-title" }, slots.title()) : null,
                slots.desc?.(),
                slots.menu ? h("details", { class: "yib-model-group-menu" }, [h("summary", "更多操作"), slots.menu()]) : null,
                h(
                    "p",
                    { class: "yib-model-group-note" },
                    rows.value.length ? "删除正在使用的模型组后，请检查任务分配。" : "尚无模型组。启动或重载插件时会自动创建默认模型组。",
                ),
                ...rows.value.map((row, index) =>
                    h("div", { class: "yib-model-group-row", key: index }, [
                        h("div", { class: "yib-model-group-actions" }, [
                            h("span", row?.name || `模型组 ${index + 1}`),
                            h(
                                "button",
                                {
                                    type: "button",
                                    disabled: props.disabled || index === 0,
                                    "aria-label": `上移模型组 ${index + 1}`,
                                    onClick: () => move(index, -1),
                                },
                                "上移",
                            ),
                            h(
                                "button",
                                {
                                    type: "button",
                                    disabled: props.disabled || index === rows.value.length - 1,
                                    "aria-label": `下移模型组 ${index + 1}`,
                                    onClick: () => move(index, 1),
                                },
                                "下移",
                            ),
                            h(
                                "button",
                                { type: "button", disabled: props.disabled, "aria-label": `删除模型组 ${index + 1}`, onClick: () => remove(index) },
                                "删除模型组",
                            ),
                        ]),
                        h(resolveComponent("k-schema"), {
                            schema: props.schema.inner,
                            modelValue: row,
                            initial: props.initial?.[index],
                            disabled: props.disabled,
                            prefix: `${(props.prefix ?? "modelGroups.").replace(/\.$/, "")}[${index}].`,
                            extra: { foldable: true },
                            "onUpdate:modelValue": (value) => {
                                if (props.disabled) return;
                                rows.value[index] = value;
                                update();
                            },
                        }),
                    ]),
                ),
                h(
                    "button",
                    {
                        type: "button",
                        disabled: props.disabled,
                        onClick: () => {
                            if (props.disabled) return;
                            rows.value.push({ name: "", strategy: "failover", models: [] });
                            update();
                        },
                    },
                    "添加模型组",
                ),
            ]);
    },
});
