import { Schema } from "koishi";

/** 将现有工具参数描述转成原生调用使用的 JSON Schema，参数验证仍由 ToolService 负责。 */
export function toolJSONSchema(schema: Schema): Record<string, any> {
    const result: Record<string, any> = {};
    if (schema.meta.description) result.description = schema.meta.description;
    if (schema.meta.default !== undefined) result.default = schema.meta.default;
    switch (schema.type) {
        case "object":
            result.type = "object";
            result.properties = Object.fromEntries(Object.entries(schema.dict || {}).map(([key, value]) => [key, toolJSONSchema(value)]));
            result.required = Object.entries(schema.dict || {}).filter(([, value]) => value.meta.required).map(([key]) => key);
            break;
        case "array": result.type = "array"; result.items = toolJSONSchema(schema.inner); break;
        case "dict": result.type = "object"; result.additionalProperties = toolJSONSchema(schema.inner); break;
        case "union": result.anyOf = schema.list.map(toolJSONSchema); break;
        case "intersect": result.allOf = schema.list.map(toolJSONSchema); break;
        case "const": result.const = schema.value; break;
        case "string": case "number": case "boolean": result.type = schema.type; break;
        case "any": break;
        default: throw new Error(`工具参数类型不支持原生调用: ${schema.type}`);
    }
    return result;
}
