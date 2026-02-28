import type { Schema } from "koishi";

export function schemaToJSONSchema(schema: Schema): Record<string, unknown> {
  if (!schema) return {};

  const type = schema.type as string;

  if (type === "object") {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    const dict = schema.dict as Record<string, Schema> | undefined;
    for (const [key, child] of Object.entries(dict ?? {})) {
      properties[key] = schemaToJSONSchema(child);
      if (child.meta?.required) required.push(key);
    }
    const result: Record<string, unknown> = { type: "object", properties };
    if (required.length) result["required"] = required;
    if (schema.meta?.description) result["description"] = schema.meta.description;
    return result;
  }

  if (type === "array") {
    return { type: "array", items: schemaToJSONSchema(schema.inner as Schema) };
  }

  if (type === "const") {
    return { const: schema.value };
  }

  if (type === "union") {
    const values = (schema.list ?? []).map((s) => (s as Schema).value);
    if (values.every((v) => v !== undefined)) return { enum: values };
    return { oneOf: (schema.list ?? []).map((s) => schemaToJSONSchema(s as Schema)) };
  }

  const base: Record<string, unknown> = { type };
  if (schema.meta?.description) base["description"] = schema.meta.description;
  return base;
}
