import { Schema } from "@koishijs/client";

const copy = (value: unknown) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

function missingRequired(schema, value): boolean {
    if (schema.meta?.hidden) return false;
    if (schema.meta?.required && (value == null || (typeof value === "string" && value.trim() === "") || (Array.isArray(value) && value.length === 0)))
        return true;
    if (schema.type === "object") {
        if (Object.hasOwn(schema.dict ?? {}, "providers") && (!Array.isArray(value?.providers) || !value.providers.length)) return true;
        const selectedModel =
            schema.dict?.evaluationModel && value?.mode && value.mode !== "off"
                ? value.evaluationModel
                : schema.dict?.model && schema.dict?.enabled && value?.enabled === true
                  ? value.model
                  : undefined;
        const needsModel = !!(
            (schema.dict?.evaluationModel && value?.mode && value.mode !== "off") ||
            (schema.dict?.model && schema.dict?.enabled && value?.enabled === true)
        );
        if (needsModel && (!selectedModel?.providerName?.trim() || !selectedModel?.modelId?.trim())) return true;
        return Object.entries(schema.dict ?? {}).some(([key, child]) => missingRequired(child, value?.[key]));
    }
    if (schema.type === "array") return Array.isArray(value) && value.some((row) => missingRequired(schema.inner, row));
    if (schema.type === "intersect") return (schema.list ?? []).some((child) => missingRequired(child, value));
    if (schema.type === "union") {
        const branch = schema.list?.find((child) => {
            try {
                new Schema(child)(copy(value));
                return true;
            } catch {
                return false;
            }
        });
        return branch ? missingRequired(branch, value) : false;
    }
    return false;
}

export function invalidConfig(schema, value): boolean {
    try {
        new Schema(schema)(copy(value));
        return missingRequired(schema, value);
    } catch {
        return true;
    }
}
