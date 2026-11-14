import { Schema } from "koishi";

/** Describe the input contract; conversion and validation still run once in ToolService. */
export function toolJSONSchema(schema: Schema): Record<string, any> {
    const meta = schema.meta ?? {};
    const result: Record<string, any> = schema.type === "transform" && schema.inner ? toolJSONSchema(schema.inner) : {};
    if (meta.description !== undefined) result.description = meta.description;
    if (meta.default !== undefined) result.default = meta.default;
    switch (schema.type) {
        case "transform":
            break;
        case "object": {
            const fields = Object.entries(schema.dict || {}).filter(([, value]) => !value.meta.hidden);
            result.type = "object";
            result.properties = Object.fromEntries(fields.map(([key, value]) => [key, toolJSONSchema(value)]));
            result.required = fields.filter(([, value]) => value.meta.required).map(([key]) => key);
            break;
        }
        case "array":
            result.type = "array";
            result.items = schema.inner ? toolJSONSchema(schema.inner) : {};
            break;
        case "dict":
            result.type = "object";
            result.additionalProperties = schema.inner ? toolJSONSchema(schema.inner) : {};
            break;
        case "tuple":
            result.type = "array";
            result.prefixItems = (schema.list ?? []).map(toolJSONSchema);
            result.minItems = result.maxItems = result.prefixItems.length;
            break;
        case "union":
            result.anyOf = (schema.list ?? []).map(toolJSONSchema);
            break;
        case "intersect":
            result.allOf = (schema.list ?? []).map(toolJSONSchema);
            break;
        case "const":
            result.const = schema.value;
            break;
        case "string":
        case "number":
        case "boolean":
            result.type = schema.type;
            break;
        case "any":
            break;
        default:
            // Custom Schemastery resolvers remain executable. An unknown input shape
            // must not prevent unrelated tools from being offered to a model.
            result["x-schemastery-type"] = schema.type;
    }
    const bounds =
        schema.type === "string"
            ? ["minLength", "maxLength"]
            : schema.type === "array"
              ? ["minItems", "maxItems"]
              : schema.type === "number"
                ? ["minimum", "maximum"]
                : [];
    if (typeof meta.min === "number" && Number.isFinite(meta.min) && bounds[0]) result[bounds[0]] = meta.min;
    if (typeof meta.max === "number" && Number.isFinite(meta.max) && bounds[1]) result[bounds[1]] = meta.max;
    if (schema.type === "number" && typeof meta.step === "number" && meta.step > 0 && Number.isFinite(meta.step)) {
        const base = typeof meta.min === "number" ? meta.min : 0;
        if (Number.isInteger(base / meta.step)) result.multipleOf = meta.step;
        else {
            result["x-step"] = meta.step;
            result["x-step-base"] = base;
        }
    }
    if (schema.type === "string" && meta.pattern) {
        const pattern = meta.pattern as { source?: string; flags?: string };
        if (typeof pattern.source === "string") result.pattern = pattern.source;
        if (pattern.flags) result["x-pattern-flags"] = pattern.flags;
    }
    return result;
}
