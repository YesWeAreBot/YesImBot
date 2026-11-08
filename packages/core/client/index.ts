import { Schema, store } from "@koishijs/client";
import { computed, defineComponent, h, ref, resolveComponent, shallowRef, watch } from "vue";

import { createConfigLayout, readConfigEntry, writeConfigEntry } from "./config-layout";
import type { ConfigEntry } from "./config-layout";
import { ModelGroups } from "./model-groups";

import "./section.css";

let nextGroupId = 0;

// Both levels own a real fold boundary. Native intersect intentionally disables
// member folding, so it cannot provide this hierarchy by collapse metadata alone.
export const ConfigFold = defineComponent({
    name: "YibConfigFold",
    props: { label: String, nested: Boolean, expanded: Boolean },
    setup(props, { slots }) {
        const collapsed = ref(!props.expanded);
        const bodyId = `yib-config-group-${++nextGroupId}`;
        return () =>
            h(props.nested ? "div" : "section", { class: props.nested ? "yib-config-subgroup" : "yib-config-section" }, [
                h(props.nested ? "h3" : "h2", { class: "yib-config-heading" }, [
                    h(
                        "button",
                        {
                            type: "button",
                            "aria-expanded": !collapsed.value,
                            "aria-controls": bodyId,
                            onClick: () => (collapsed.value = !collapsed.value),
                        },
                        [h("span", props.label), h("span", { class: "yib-config-toggle", "aria-hidden": true }, collapsed.value ? "展开" : "收起")],
                    ),
                ]),
                // Do not unmount native controls when folding: drafts and menu state
                // must survive, including arrays, dynamic unions and computed fields.
                h("div", { id: bodyId, class: "yib-config-body", hidden: collapsed.value }, slots.default?.()),
            ]);
    },
});

// Existing independently configured extensions still use this public role.
// Keep their fold boundary while the core form uses the purpose-based layout.
export const ConfigSection = defineComponent({
    name: "YibConfigSection",
    inheritAttrs: false,
    props: ["schema", "modelValue", "initial", "disabled", "prefix", "extra"],
    emits: ["update:modelValue"],
    setup(props, { emit, attrs }) {
        const inner = computed(() => {
            const { role: _role, description: _description, collapse: _collapse, ...meta } = props.schema.meta;
            return { ...props.schema, meta };
        });
        return () =>
            h(
                ConfigFold,
                { ...attrs, label: props.schema.meta.description, expanded: !props.schema.meta.collapse },
                {
                    default: () =>
                        h(resolveComponent("k-schema"), {
                            schema: inner.value,
                            modelValue: props.modelValue,
                            initial: props.initial,
                            disabled: props.disabled,
                            prefix: props.prefix,
                            extra: { ...props.extra, foldable: false },
                            "onUpdate:modelValue": (value) => {
                                if (!props.disabled) emit("update:modelValue", value);
                            },
                        }),
                },
            );
    },
});

function nativeSchema(entry: ConfigEntry, inline: boolean) {
    if (!["object", "intersect"].includes(entry.schema.type)) return entry.schema;
    return { ...entry.schema, meta: { ...entry.schema.meta, description: inline ? undefined : entry.schema.meta.description, collapse: !inline } };
}

export const PurposeConfig = defineComponent({
    name: "YibPurposeConfig",
    inheritAttrs: false,
    props: ["schema", "modelValue", "initial", "disabled", "prefix", "extra"],
    emits: ["update:modelValue"],
    setup(props, { emit, attrs, slots }) {
        // Native controls can emit several updates before the parent echoes new
        // props. Apply each edit to the latest draft, so sibling edits compose.
        const draft = shallowRef(props.modelValue);
        watch(
            () => props.modelValue,
            (value) => (draft.value = value),
            { deep: true },
        );
        const layout = computed(() => {
            // Console payloads are { uid, refs } graphs, just like the native
            // dynamic editor's input. Resolve them before reading schema fields.
            const registry = store.schema?.["toolService.availableExtensions"];
            return createConfigLayout(props.schema, registry ? { "toolService.availableExtensions": new Schema(registry) } : {}, draft.value);
        });
        const renderEntry = (entry: ConfigEntry, inline: boolean) =>
            h(
                resolveComponent("k-schema"),
                {
                    key: entry.path.join("."),
                    schema: nativeSchema(entry, inline),
                    modelValue: readConfigEntry(draft.value, entry),
                    initial: readConfigEntry(props.initial, entry),
                    disabled: props.disabled,
                    prefix: `${props.prefix ?? ""}${entry.path.join(".")}.`,
                    extra: inline ? { foldable: false } : undefined,
                    "onUpdate:modelValue": (value) => {
                        if (props.disabled) return;
                        draft.value = writeConfigEntry(draft.value, entry, value);
                        emit("update:modelValue", draft.value);
                    },
                },
                {
                    title: () => [
                        h("span", { class: "prefix" }, `${props.prefix ?? ""}${entry.path.slice(0, -1).join(".")}${entry.path.length > 1 ? "." : ""}`),
                        h("span", entry.path.at(-1)),
                    ],
                },
            );
        return () =>
            h("div", { ...attrs, class: ["yib-config-layout", attrs.class] }, [
                slots.menu ? h("details", { class: "yib-config-actions" }, [h("summary", "配置操作"), slots.menu()]) : null,
                ...layout.value.map((category, index) =>
                    h(
                        ConfigFold,
                        { key: category.id, label: category.label, expanded: index === 0 },
                        {
                            default: () =>
                                category.groups.map((group) =>
                                    h(
                                        ConfigFold,
                                        { key: group.id, label: group.label, nested: true },
                                        {
                                            default: () => [
                                                group.note ? h("p", { class: "yib-config-note" }, group.note) : null,
                                                ...group.entries.map((entry) => renderEntry(entry, group.entries.length === 1 && !entry.schema.meta?.role)),
                                            ],
                                        },
                                    ),
                                ),
                        },
                    ),
                ),
            ]);
    },
});

export default function apply(ctx) {
    ctx.schema({ type: "array", role: "yib-model-groups", component: ModelGroups });
    ctx.schema({ type: "intersect", role: "yib-settings", component: PurposeConfig });
    for (const type of ["object", "intersect"]) ctx.schema({ type, role: "yib-section", component: ConfigSection });
}
