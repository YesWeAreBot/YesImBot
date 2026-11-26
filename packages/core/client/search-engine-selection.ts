import { defineComponent, h } from "vue";

export const SearchEngineSelection = defineComponent({
    name: "YibSearchEngineSelection",
    props: ["engines", "modelValue", "disabled"],
    emits: ["update:modelValue"],
    setup(props, { emit }) {
        return () => {
            const selected = new Set<string>(Array.isArray(props.modelValue) ? props.modelValue : []);
            const choices = new Map<string, string>();
            for (const engine of Array.isArray(props.engines) ? props.engines : []) {
                if (typeof engine?.id !== "string" || !engine.id.trim()) continue;
                choices.set(engine.id.trim(), typeof engine.backend === "string" ? engine.backend : "");
            }
            for (const id of selected) {
                if (!choices.has(id)) choices.set(id, "未配置");
            }
            return h("fieldset", { class: "yib-search-engines", disabled: props.disabled }, [
                h("legend", "选择参与搜索的引擎"),
                choices.size
                    ? h("p", { class: "yib-config-note" }, "无勾选时停用搜索。")
                    : h("p", { class: "yib-config-note" }, "请先添加搜索引擎并填写标识。"),
                ...Array.from(choices, ([id, label]) =>
                    h("label", { key: id }, [
                        h("input", {
                            type: "checkbox",
                            checked: selected.has(id),
                            onChange: (event: Event) => {
                                if (props.disabled) return;
                                const checked = (event.target as HTMLInputElement).checked;
                                const current = new Set<string>(Array.isArray(props.modelValue) ? props.modelValue : []);
                                if (checked) current.add(id);
                                else current.delete(id);
                                emit("update:modelValue", [...current]);
                            },
                        }),
                        h("span", label ? `${id}（${label}）` : id),
                    ]),
                ),
            ]);
        };
    },
});
